/**
 * NEXUA名刺ポケット 同期バックエンド（合言葉方式）
 * 実行者: 開発者権限(USER_DEPLOYING)。データは運営管理のこのスプレッドシートに保存される。
 * 名刺のテキストデータのみを扱う。写真は別（ユーザー自身のGoogle Drive、クライアント側で直接処理）。
 */
const SHEET_USERS = 'users';
// 合言葉の文字種: 0/O, 1/I など見分けにくい文字を除外
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  // GETリクエストでは書き込み系アクション（issue_code, save_bookmarks）を実行させない
  // ブラウザのリンクプレビューボット等が意図せずアクセスして副作用を起こすリスク対策
  const route = ROUTES[p.action];
  if (route && route.write) {
    return jsonResponse({ success: false, error: 'GET非対応', code: 'METHOD_NOT_ALLOWED' });
  }
  return handle(p);
}

function doPost(e) {
  let p;
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: 'invalid JSON', code: 'BAD_REQUEST' });
  }
  return handle(p);
}

// ルーティングテーブル。auth: "none"=誰でも呼べる / "code"=合言葉が実在すること。
// write: true の場合はLockServiceで直列化する（NEXUA本体gas_backend.jsと同じ設計）
const ROUTES = {
  issue_code: { auth: 'none', write: true, handler: () => issueCode() },
  get_bookmarks: { auth: 'code', write: false, handler: (p) => getBookmarks(p.code) },
  save_bookmarks: { auth: 'code', write: true, handler: (p) => saveBookmarks(p.code, p.bookmarks) },
};

function handle(p) {
  const route = ROUTES[p.action];
  if (!route) return jsonResponse({ success: false, error: 'unknown action', code: 'UNKNOWN_ACTION' });
  try {
    if (route.auth === 'code') {
      if (!checkRateLimit(p.code)) {
        return jsonResponse({ success: false, error: 'アクセスが集中しています。しばらくしてからお試しください', code: 'RATE_LIMITED' });
      }
      if (!findUserRow(p.code)) {
        return jsonResponse({ success: false, error: '合言葉が見つかりません', code: 'CODE_INVALID' });
      }
    }
    if (route.write) {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(20 * 1000)) {
        return jsonResponse({ success: false, error: '混み合っています。もう一度お試しください', code: 'BUSY' });
      }
      try {
        return jsonResponse(route.handler(p));
      } finally {
        lock.releaseLock();
      }
    }
    return jsonResponse(route.handler(p));
  } catch (err) {
    return jsonResponse({ success: false, error: err.message, code: 'INTERNAL' });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  const ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : createNewSpreadsheet(props);
  let sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_USERS);
    sheet.appendRow(['code', 'createdAt', 'stripeCustomerEmail', 'bookmarksJson']);
  }
  return sheet;
}

function createNewSpreadsheet(props) {
  const ss = SpreadsheetApp.create('NEXUA名刺ポケット 合言葉データ');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

// 合言葉ごとに1分あたりのリクエスト数を制限する（正規の合言葉への
// 過剰アクセス・誤動作したクライアントからの連投対策）。注意: これは
// 合言葉の総当たり攻撃には効かない。攻撃者は毎回違う合言葉を試すため
// キー(rl_<code>)が毎回変わり、この制限には引っかからない。
//
// 合言葉に依存しないグローバルな失敗回数制限も一時検討したが、それ自体が
// 認証不要で誰でも発火できてしまい、正規ユーザー全員を巻き込むDoSの
// 手段になってしまうため撤回した。合言葉は32^8(≈1.1兆)通りあり、GAS自体の
// 実行時間・呼び出し回数クォータが総当たりへの実質的な歯止めになっている
const RATE_LIMIT_MAX_PER_WINDOW = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

function checkRateLimit(code) {
  const cache = CacheService.getScriptCache();
  const key = 'rl_' + code;
  const count = Number(cache.get(key) || '0') + 1;
  cache.put(key, String(count), RATE_LIMIT_WINDOW_SECONDS);
  return count <= RATE_LIMIT_MAX_PER_WINDOW;
}

// 合言葉→行番号のキャッシュ。全行スキャン(下記)は発行済み合言葉の数に
// 比例して遅くなるため、一度見つけた行はキャッシュしてスキャンを省略する
const USER_ROW_CACHE_PREFIX = 'row_';
const USER_ROW_CACHE_TTL_SECONDS = 21600; // CacheServiceのTTL上限(6時間)

// 1-indexedの行番号を返す（ヘッダー行を除く）。見つからなければnull。
// 合言葉の照合にはA列だけあれば十分なため、bookmarksJson列を含む全列を
// 毎回読み込まず、getRangeでA列だけを読む（データが増えるほど重くなる
// getDataRange().getValues()を避ける）
function findUserRow(code) {
  if (!code) return null;
  const cache = CacheService.getScriptCache();
  const cacheKey = USER_ROW_CACHE_PREFIX + code;
  const cachedRow = cache.get(cacheKey);
  if (cachedRow) {
    const row = Number(cachedRow);
    // キャッシュされた行が今も本当にその合言葉のものか確認する
    // （シート側で行の削除・並び替えが起きた場合のズレ対策）
    if (getSheet().getRange(row, 1).getValue() === code) return row;
  }
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null; // ヘッダー行のみ、またはヘッダーすら無い
  const codes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < codes.length; i++) {
    if (codes[i][0] === code) {
      const row = i + 2;
      cache.put(cacheKey, String(row), USER_ROW_CACHE_TTL_SECONDS);
      return row;
    }
  }
  return null;
}

// Math.random()は暗号学的に安全な乱数ではないため、Utilities.getUuid()由来の
// 16進数を2桁ずつCODE_CHARSのインデックスに変換して使う。256(=16進数2桁の
// 取りうる値の数)はCODE_CHARSの文字数32でちょうど割り切れるため、変換に
// 偏りが出ない
function generateCode() {
  const hex = Utilities.getUuid().replace(/-/g, '');
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    code += CODE_CHARS[byte % CODE_CHARS.length];
  }
  return code;
}

function issueCode() {
  const sheet = getSheet();
  let code;
  do {
    code = generateCode();
  } while (findUserRow(code));
  sheet.appendRow([code, new Date().toISOString(), '', '[]']);
  // 発行直後のget_bookmarks/save_bookmarksから全行スキャンせずに済むよう、
  // 行番号を先回りしてキャッシュしておく
  CacheService.getScriptCache().put(USER_ROW_CACHE_PREFIX + code, String(sheet.getLastRow()), USER_ROW_CACHE_TTL_SECONDS);
  return { success: true, code };
}

function getBookmarks(code) {
  const row = findUserRow(code);
  const json = getSheet().getRange(row, 4).getValue() || '[]';
  let bookmarks;
  try {
    bookmarks = JSON.parse(json);
  } catch (err) {
    bookmarks = [];
  }
  return { success: true, bookmarks };
}

// スプレッドシートの1セルには文字数上限(約5万字)があり、それを超えると
// setValueがエラーになり以後そのユーザーが保存できなくなってしまう。
// bookmarksの中身は検証していなかったため、合言葉さえ分かれば巨大な
// ダミーデータを送りつけてこの状態を意図的に作れてしまっていた
const MAX_BOOKMARKS_COUNT = 500;
const MAX_BOOKMARKS_JSON_LENGTH = 45000;

function saveBookmarks(code, bookmarks) {
  // bookmarksが配列でない場合、従来は黙って空配列に読み替えて保存成功を
  // 返しており、不正な呼び出し（バグ等）でユーザーの既存データがエラーも
  // 出さずに消えてしまっていた。配列でなければ保存せずエラーを返す
  if (!Array.isArray(bookmarks)) {
    return { success: false, error: 'データの形式が不正です', code: 'INVALID_PAYLOAD' };
  }
  const list = bookmarks;
  if (list.length > MAX_BOOKMARKS_COUNT) {
    return { success: false, error: `保存できる名刺は${MAX_BOOKMARKS_COUNT}件までです`, code: 'TOO_MANY_BOOKMARKS' };
  }
  const json = JSON.stringify(list);
  if (json.length > MAX_BOOKMARKS_JSON_LENGTH) {
    return { success: false, error: 'データが大きすぎます', code: 'PAYLOAD_TOO_LARGE' };
  }
  const row = findUserRow(code);
  getSheet().getRange(row, 4).setValue(json);
  return { success: true };
}
