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
    if (route.auth === 'code' && !findUserRow(p.code)) {
      return jsonResponse({ success: false, error: '合言葉が見つかりません', code: 'CODE_INVALID' });
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_USERS);
    sheet.appendRow(['code', 'createdAt', 'stripeCustomerEmail', 'bookmarksJson']);
  }
  return sheet;
}

// 1-indexedの行番号を返す（ヘッダー行を除く）。見つからなければnull
function findUserRow(code) {
  if (!code) return null;
  const rows = getSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === code) return i + 1;
  }
  return null;
}

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
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

function saveBookmarks(code, bookmarks) {
  const row = findUserRow(code);
  getSheet().getRange(row, 4).setValue(JSON.stringify(bookmarks || []));
  return { success: true };
}
