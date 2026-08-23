import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GASのSpreadsheetオブジェクトの最小モック（NEXUA本体 tests/gas_mock_test.cjs と同じ方針）
class MockSheet {
  constructor() { this.rows = []; this.rangeScanCount = 0; } // rangeScanCount: 複数行のgetRange(全行スキャン)が呼ばれた回数
  getDataRange() { return { getValues: () => this.rows.map((r) => [...r]) }; }
  appendRow(r) { this.rows.push([...r]); }
  getLastRow() { return this.rows.length; }
  // 単一セル: getRange(row, col) / 範囲: getRange(row, col, numRows, numCols)
  getRange(r, c, numRows, numCols) {
    const self = this;
    if (numRows !== undefined) {
      self.rangeScanCount++;
      return {
        getValues: () => {
          const result = [];
          for (let i = 0; i < numRows; i++) {
            const row = self.rows[r - 1 + i] || [];
            const cols = [];
            for (let j = 0; j < (numCols || 1); j++) {
              cols.push(row[c - 1 + j] ?? '');
            }
            result.push(cols);
          }
          return result;
        },
      };
    }
    return {
      getValue: () => (self.rows[r - 1] || [])[c - 1] ?? '',
      setValue: (v) => {
        while (self.rows.length < r) self.rows.push([]);
        self.rows[r - 1][c - 1] = v;
      },
    };
  }
}

let sandbox;
let mockStripeEvents; // eventId -> event object（テストから登録する「Stripeに実在するイベント」）

beforeEach(() => {
  mockStripeEvents = {};
  const sheets = {};
  const spreadsheets = {}; // ID -> { sheets: {...}, getId: () => id } の形式
  let nextSpreadsheetId = 1;
  const scriptProps = {}; // PropertiesServiceが永続的に保存するデータ
  scriptProps['STRIPE_API_KEY'] = 'sk_test_dummy';
  const cacheStore = new Map(); // CacheServiceが永続的に保存するデータ（TTLは無視し常に保持する簡易モック）

  const createMockSpreadsheet = () => ({
    sheets: {},
    getId: () => `mock-ss-${nextSpreadsheetId}`,
  });

  sandbox = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = new MockSheet()),
      }),
      create: (name) => {
        const id = `mock-ss-${nextSpreadsheetId++}`;
        const ss = createMockSpreadsheet();
        spreadsheets[id] = ss;
        return {
          getSheetByName: (n) => ss.sheets[n] || null,
          insertSheet: (n) => (ss.sheets[n] = new MockSheet()),
          getId: () => id,
        };
      },
      openById: (id) => ({
        getSheetByName: (n) => spreadsheets[id].sheets[n] || null,
        insertSheet: (n) => (spreadsheets[id].sheets[n] = new MockSheet()),
        getId: () => id,
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => scriptProps[key] || null,
        setProperty: (key, value) => { scriptProps[key] = value; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => (cacheStore.has(key) ? cacheStore.get(key) : null),
        put: (key, value) => { cacheStore.set(key, value); },
        remove: (key) => { cacheStore.delete(key); },
      }),
    },
    UrlFetchApp: {
      fetch: (url) => {
        const eventId = url.split('/').pop();
        const event = mockStripeEvents[eventId];
        return {
          getResponseCode: () => (event ? 200 : 404),
          getContentText: () => JSON.stringify(event || { error: { message: 'not found' } }),
        };
      },
    },
    HtmlService: {
      createHtmlOutput: (t) => ({ _t: t, _isHtml: true }),
    },
    ContentService: {
      createTextOutput: (t) => ({ _t: t, setMimeType() { return this; } }),
      MimeType: { JSON: 1 },
    },
    Utilities: { getUuid: () => crypto.randomUUID() },
    Math, Date, JSON, Array, String, Number,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), sandbox);
});

function post(payload) {
  const doPost = vm.runInContext('doPost', sandbox);
  return JSON.parse(doPost({ postData: { contents: JSON.stringify(payload) } })._t);
}

function get(params) {
  const doGet = vm.runInContext('doGet', sandbox);
  return JSON.parse(doGet({ parameter: params })._t);
}

// Stripe Webhookを模したdoPost呼び出し（?stripe_webhook=1相当）
function postWebhook(payload) {
  const doPost = vm.runInContext('doPost', sandbox);
  const result = doPost({ postData: { contents: JSON.stringify(payload) }, parameter: { stripe_webhook: '1' } });
  assert.equal(result._isHtml, true, 'Webhook応答はHtmlServiceで返るはず(302回避)');
  return JSON.parse(result._t);
}

// テスト用: Stripe決済完了を模して合言葉を1件発行するヘルパー。
// 既存のpost({action:'issue_code'})を置き換える
let issueTestCodeCounter = 0;
function issueTestCode() {
  issueTestCodeCounter += 1;
  const sessionId = 'cs_test_auto' + issueTestCodeCounter;
  const eventId = 'evt_test_auto' + issueTestCodeCounter;
  registerStripeEvent({
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: { id: sessionId, mode: 'payment', payment_status: 'paid', amount_total: 300 } },
  });
  postWebhook({ id: eventId });
  const claimRes = post({ action: 'claim_code', session_id: sessionId });
  return claimRes.code;
}

test('generateCode: Utilities.getUuid()ベースで生成し、書式・偏りの無さを確認する', () => {
  // issueCode()のリトライループ（既存コード重複時は再生成）を経由すると
  // 一意性が保証されてしまいUtilities.getUuid()側の分布は検証できないため、
  // generateCode()を直接呼び出して確認する
  const generateCode = vm.runInContext('generateCode', sandbox);
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const code = generateCode();
    assert.match(code, /^[A-Z0-9]{8}$/);
    assert.equal(/[0O1I]/.test(code), false);
    seen.add(code);
  }
  // Math.random()禁止（UUIDベースの乱数を使っている）ことの簡易確認:
  // 50回中、大半がユニークであること（固定値を返す等の壊れた実装を検知する）
  assert.ok(seen.size > 45, `重複が多すぎる: ユニーク数=${seen.size}/50`);
});

test('get_bookmarks: 発行直後は空配列を返す', () => {
  const code = issueTestCode();
  const res = post({ action: 'get_bookmarks', code });
  assert.equal(res.success, true);
  assert.deepEqual(res.bookmarks, []);
});

test('save_bookmarks → get_bookmarksで保存した内容がそのまま読める', () => {
  const code = issueTestCode();
  const bookmarks = [{ url: 'https://nexua.tech/#zz1', name: '山田', tags: ['DIY'], memo: '展示会で交換' }];
  const saveRes = post({ action: 'save_bookmarks', code, bookmarks });
  assert.equal(saveRes.success, true);
  const getRes = post({ action: 'get_bookmarks', code });
  assert.deepEqual(getRes.bookmarks, bookmarks);
});

test('save_bookmarksは前回の内容を上書きする（追記ではない）', () => {
  const code = issueTestCode();
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'a', name: '1件目' }] });
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'b', name: '2件目' }] });
  const res = post({ action: 'get_bookmarks', code });
  assert.equal(res.bookmarks.length, 1);
  assert.equal(res.bookmarks[0].name, '2件目');
});

test('save_bookmarks: 件数上限(MAX_BOOKMARKS_COUNT)を超えるとTOO_MANY_BOOKMARKSエラー', () => {
  const code = issueTestCode();
  const MAX = vm.runInContext('MAX_BOOKMARKS_COUNT', sandbox);
  const tooMany = Array.from({ length: MAX + 1 }, (_, i) => ({ url: `u${i}`, name: `n${i}` }));
  const res = post({ action: 'save_bookmarks', code, bookmarks: tooMany });
  assert.equal(res.success, false);
  assert.equal(res.code, 'TOO_MANY_BOOKMARKS');
  // 拒否した場合は保存されていないこと（発行直後の空配列のまま）
  const getRes = post({ action: 'get_bookmarks', code });
  assert.deepEqual(getRes.bookmarks, []);
});

test('save_bookmarks: 件数上限ちょうどは保存できる（境界値）', () => {
  const code = issueTestCode();
  const MAX = vm.runInContext('MAX_BOOKMARKS_COUNT', sandbox);
  const exactly = Array.from({ length: MAX }, (_, i) => ({ url: `u${i}`, name: `n${i}` }));
  const res = post({ action: 'save_bookmarks', code, bookmarks: exactly });
  assert.equal(res.success, true);
});

test('save_bookmarks: JSON文字数上限(MAX_BOOKMARKS_JSON_LENGTH)を超えるとPAYLOAD_TOO_LARGEエラー', () => {
  const code = issueTestCode();
  const hugeMemo = 'x'.repeat(60000);
  const res = post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'a', name: 'n', memo: hugeMemo }] });
  assert.equal(res.success, false);
  assert.equal(res.code, 'PAYLOAD_TOO_LARGE');
});

test('save_bookmarks: bookmarksが配列でない場合はエラーを返し、既存データは消さない', () => {
  const code = issueTestCode();
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'a', name: '既存データ' }] });
  const res = post({ action: 'save_bookmarks', code, bookmarks: 'not-an-array' });
  assert.equal(res.success, false);
  assert.equal(res.code, 'INVALID_PAYLOAD');
  // 不正なペイロードを拒否しても、既存データが空配列に上書きされていないこと
  const getRes = post({ action: 'get_bookmarks', code });
  assert.equal(getRes.bookmarks.length, 1);
  assert.equal(getRes.bookmarks[0].name, '既存データ');
});

test('get_bookmarks: 存在しない合言葉はCODE_INVALIDエラー', () => {
  const res = post({ action: 'get_bookmarks', code: 'NOTFOUND' });
  assert.equal(res.success, false);
  assert.equal(res.code, 'CODE_INVALID');
});

test('save_bookmarks: 存在しない合言葉はCODE_INVALIDエラー', () => {
  const res = post({ action: 'save_bookmarks', code: 'NOTFOUND', bookmarks: [] });
  assert.equal(res.success, false);
  assert.equal(res.code, 'CODE_INVALID');
});

test('findUserRow: 初回はシート全行をスキャンし、2回目以降はキャッシュヒットしてスキャンしない', () => {
  const sheet = vm.runInContext('getSheet()', sandbox);
  sheet.appendRow(['MANUALCODE', new Date().toISOString(), '', '[]']);
  const findUserRow = vm.runInContext('findUserRow', sandbox);
  const scanBefore = sheet.rangeScanCount;
  const row1 = findUserRow('MANUALCODE');
  assert.equal(sheet.rangeScanCount, scanBefore + 1, '初回はキャッシュが無いのでスキャンするはず');
  const row2 = findUserRow('MANUALCODE');
  assert.equal(row2, row1);
  assert.equal(sheet.rangeScanCount, scanBefore + 1, '2回目はキャッシュヒットしてスキャンしないはず');
});

test('findUserRow: 合言葉発行直後はキャッシュ済みのため、get_bookmarksで全行スキャンが発生しない', () => {
  const code = issueTestCode();
  const sheet = vm.runInContext('getSheet()', sandbox);
  const scanBefore = sheet.rangeScanCount;
  const res = post({ action: 'get_bookmarks', code });
  assert.equal(res.success, true);
  assert.equal(sheet.rangeScanCount, scanBefore, '発行時点でキャッシュ済みのためスキャンなしでヒットするはず');
});

test('findUserRow: キャッシュがシートの実際の行とズレていたら、古いキャッシュを消してスキャンにフォールバックする', () => {
  const sheet = vm.runInContext('getSheet()', sandbox);
  sheet.appendRow(['MANUALCODE', new Date().toISOString(), '', '[]']); // 行2
  const findUserRow = vm.runInContext('findUserRow', sandbox);
  const row1 = findUserRow('MANUALCODE');
  assert.equal(row1, 2);

  // シート側で行がズレた状況を再現（ヘッダーとMANUALCODEの間に1行挿入）。
  // この時点でキャッシュはまだ古い行2を指したまま
  sheet.rows.splice(1, 0, ['DUMMY', new Date().toISOString(), '', '[]']);

  const scanBefore = sheet.rangeScanCount;
  const row2 = findUserRow('MANUALCODE');
  assert.equal(row2, 3, 'ズレを検知して正しい行(3)を返すはず');
  assert.equal(sheet.rangeScanCount, scanBefore + 1, 'ズレを検知したらスキャンにフォールバックするはず');

  // 古いキャッシュが消され、新しい行でキャッシュされているはずなので、
  // 次回はスキャン無しでヒットする
  const scanBefore2 = sheet.rangeScanCount;
  const row3 = findUserRow('MANUALCODE');
  assert.equal(row3, 3);
  assert.equal(sheet.rangeScanCount, scanBefore2, '新しいキャッシュでヒットしスキャンしないはず');
});

test('レート制限: 同じ合言葉への短時間の大量アクセスはRATE_LIMITEDエラー', () => {
  const code = issueTestCode();
  const RATE_LIMIT_MAX_PER_WINDOW = vm.runInContext('RATE_LIMIT_MAX_PER_WINDOW', sandbox);
  for (let i = 0; i < RATE_LIMIT_MAX_PER_WINDOW; i++) {
    const res = post({ action: 'get_bookmarks', code });
    assert.equal(res.success, true, `${i + 1}回目は上限内なので成功するはず`);
  }
  const blocked = post({ action: 'get_bookmarks', code });
  assert.equal(blocked.success, false);
  assert.equal(blocked.code, 'RATE_LIMITED');
});

test('レート制限: save_bookmarks(write系)にもかかる', () => {
  const code = issueTestCode();
  const RATE_LIMIT_MAX_PER_WINDOW = vm.runInContext('RATE_LIMIT_MAX_PER_WINDOW', sandbox);
  for (let i = 0; i < RATE_LIMIT_MAX_PER_WINDOW; i++) {
    post({ action: 'save_bookmarks', code, bookmarks: [] });
  }
  const blocked = post({ action: 'save_bookmarks', code, bookmarks: [] });
  assert.equal(blocked.success, false);
  assert.equal(blocked.code, 'RATE_LIMITED');
});

test('レート制限: 合言葉ごとに別々にカウントされる（片方が制限されてももう片方は影響しない）', () => {
  const codeA = issueTestCode();
  const codeB = issueTestCode();
  const RATE_LIMIT_MAX_PER_WINDOW = vm.runInContext('RATE_LIMIT_MAX_PER_WINDOW', sandbox);
  for (let i = 0; i < RATE_LIMIT_MAX_PER_WINDOW + 1; i++) {
    post({ action: 'get_bookmarks', code: codeA });
  }
  const resB = post({ action: 'get_bookmarks', code: codeB });
  assert.equal(resB.success, true);
});

test('未知のactionはUNKNOWN_ACTIONエラー', () => {
  const res = post({ action: 'nonexistent' });
  assert.equal(res.success, false);
  assert.equal(res.code, 'UNKNOWN_ACTION');
});

test('doGET: save_bookmarks（write系）はMETHOD_NOT_ALLOWEDエラー', () => {
  const res = get({ action: 'save_bookmarks', code: 'DUMMY', bookmarks: [] });
  assert.equal(res.success, false);
  assert.equal(res.code, 'METHOD_NOT_ALLOWED');
});

test('doGET: get_bookmarks（read系）はPOSTと同じく動作可能', () => {
  const code = issueTestCode();
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'test', name: 'テスト' }] });
  const res = get({ action: 'get_bookmarks', code });
  assert.equal(res.success, true);
  assert.equal(res.bookmarks.length, 1);
  assert.equal(res.bookmarks[0].name, 'テスト');
});

test('stripeApiGet: 登録済みイベントIDなら200でイベント本体を返す', () => {
  registerStripeEvent({ id: 'evt_test1', type: 'checkout.session.completed' });
  const stripeApiGet = vm.runInContext('stripeApiGet', sandbox);
  const event = stripeApiGet('events/evt_test1');
  assert.equal(event.id, 'evt_test1');
  assert.equal(event.type, 'checkout.session.completed');
});

test('stripeApiGet: 未登録のイベントIDなら例外を投げる', () => {
  const stripeApiGet = vm.runInContext('stripeApiGet', sandbox);
  assert.throws(() => stripeApiGet('events/evt_unknown'), /Stripe API error/);
});

test('issueCode: メールアドレスを渡すとC列(stripeCustomerEmail)に保存される', () => {
  const issueCode = vm.runInContext('issueCode', sandbox);
  const res = issueCode('buyer@example.com');
  assert.equal(res.success, true);
  const sheet = vm.runInContext('getSheet()', sandbox);
  const row = sheet.rows.find((r) => r[0] === res.code);
  assert.equal(row[2], 'buyer@example.com');
});

test('issueCode: メールアドレス省略時はC列が空文字列', () => {
  const issueCode = vm.runInContext('issueCode', sandbox);
  const res = issueCode();
  assert.equal(res.success, true);
  const sheet = vm.runInContext('getSheet()', sandbox);
  const row = sheet.rows.find((r) => r[0] === res.code);
  assert.equal(row[2], '');
});

test('claim_code: session_id未指定はBAD_REQUESTエラー', () => {
  const res = post({ action: 'claim_code' });
  assert.equal(res.success, false);
  assert.equal(res.code, 'BAD_REQUEST');
});

test('claim_code: キャッシュに無いsession_idはPENDINGを返す', () => {
  const res = post({ action: 'claim_code', session_id: 'cs_test_unknown' });
  assert.equal(res.success, false);
  assert.equal(res.code, 'PENDING');
});

test('claim_code: CacheServiceに合言葉が置かれていれば取得できる', () => {
  const cache = vm.runInContext('CacheService.getScriptCache()', sandbox);
  cache.put('claim_cs_test_123', 'ABCDEFGH', 3600);
  const res = post({ action: 'claim_code', session_id: 'cs_test_123' });
  assert.equal(res.success, true);
  assert.equal(res.code, 'ABCDEFGH');
});

test('claim_code: 1分あたりの上限を超えるとRATE_LIMITEDエラー', () => {
  const MAX = vm.runInContext('CLAIM_RATE_LIMIT_MAX_PER_WINDOW', sandbox);
  for (let i = 0; i < MAX; i++) {
    const res = post({ action: 'claim_code', session_id: 'cs_test_rl' });
    assert.equal(res.code, 'PENDING', `${i + 1}回目は上限内なのでPENDINGのはず`);
  }
  const blocked = post({ action: 'claim_code', session_id: 'cs_test_rl' });
  assert.equal(blocked.success, false);
  assert.equal(blocked.code, 'RATE_LIMITED');
});

test('doGET: claim_code（read系）はPOSTと同じく動作可能', () => {
  const cache = vm.runInContext('CacheService.getScriptCache()', sandbox);
  cache.put('claim_cs_test_get', 'ZZYYXXWW', 3600);
  const res = get({ action: 'claim_code', session_id: 'cs_test_get' });
  assert.equal(res.success, true);
  assert.equal(res.code, 'ZZYYXXWW');
});

// テストから「Stripeに実在するイベント」を登録するヘルパー。
// stripeApiGet('events/'+id)のモック応答に使われる
function registerStripeEvent(event) {
  mockStripeEvents[event.id] = event;
}

test('handleCheckoutCompleted: mode=payment, amount_total=300なら合言葉を発行してキャッシュに置く', () => {
  const handleCheckoutCompleted = vm.runInContext('handleCheckoutCompleted', sandbox);
  handleCheckoutCompleted({
    id: 'cs_test_ok',
    mode: 'payment',
    payment_status: 'paid',
    amount_total: 300,
    customer_details: { email: 'buyer@example.com' },
  });
  const cache = vm.runInContext('CacheService.getScriptCache()', sandbox);
  const code = cache.get('claim_cs_test_ok');
  assert.match(code, /^[A-Z0-9]{8}$/);
  const sheet = vm.runInContext('getSheet()', sandbox);
  const row = sheet.rows.find((r) => r[0] === code);
  assert.equal(row[2], 'buyer@example.com');
});

test('handleCheckoutCompleted: mode=subscriptionは無視する（買い切り以外は対象外）', () => {
  const handleCheckoutCompleted = vm.runInContext('handleCheckoutCompleted', sandbox);
  handleCheckoutCompleted({ id: 'cs_test_sub', mode: 'subscription', payment_status: 'paid', amount_total: 300 });
  const cache = vm.runInContext('CacheService.getScriptCache()', sandbox);
  assert.equal(cache.get('claim_cs_test_sub'), null);
});

test('handleCheckoutCompleted: 想定外の金額は無視する（不正対策）', () => {
  const handleCheckoutCompleted = vm.runInContext('handleCheckoutCompleted', sandbox);
  handleCheckoutCompleted({ id: 'cs_test_wrongamount', mode: 'payment', payment_status: 'paid', amount_total: 1 });
  const cache = vm.runInContext('CacheService.getScriptCache()', sandbox);
  assert.equal(cache.get('claim_cs_test_wrongamount'), null);
});

test('handleCheckoutCompleted: payment_statusがpaid以外は無視する', () => {
  const handleCheckoutCompleted = vm.runInContext('handleCheckoutCompleted', sandbox);
  handleCheckoutCompleted({ id: 'cs_test_unpaid', mode: 'payment', payment_status: 'unpaid', amount_total: 300 });
  const cache = vm.runInContext('CacheService.getScriptCache()', sandbox);
  assert.equal(cache.get('claim_cs_test_unpaid'), null);
});

test('E2E: Stripe決済完了Webhook→claim_codeで合言葉を取得できる', () => {
  const sessionId = 'cs_test_e2e';
  const eventId = 'evt_test_e2e';
  registerStripeEvent({
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: { id: sessionId, mode: 'payment', payment_status: 'paid', amount_total: 300 } },
  });

  const webhookRes = postWebhook({ id: eventId });
  assert.equal(webhookRes.success, true);

  const claimRes = post({ action: 'claim_code', session_id: sessionId });
  assert.equal(claimRes.success, true);
  assert.match(claimRes.code, /^[A-Z0-9]{8}$/);

  // 発行された合言葉でget_bookmarksが呼べること（通常フローと接続していることの確認）
  const getRes = post({ action: 'get_bookmarks', code: claimRes.code });
  assert.equal(getRes.success, true);
  assert.deepEqual(getRes.bookmarks, []);
});

test('E2E: 同じWebhookイベントを2回送っても合言葉は1回しか発行されない(冪等性)', () => {
  const sessionId = 'cs_test_dedupe';
  const eventId = 'evt_test_dedupe';
  registerStripeEvent({
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: { id: sessionId, mode: 'payment', payment_status: 'paid', amount_total: 300 } },
  });

  const first = postWebhook({ id: eventId });
  assert.equal(first.success, true);
  const firstCode = post({ action: 'claim_code', session_id: sessionId }).code;

  const second = postWebhook({ id: eventId });
  assert.equal(second.skipped, 'duplicate');
  const secondCode = post({ action: 'claim_code', session_id: sessionId }).code;

  assert.equal(firstCode, secondCode, '重複Webhookで別の合言葉が発行されてはいけない');
});

test('handleStripeWebhook: 未登録(実在しない)イベントIDは拒否する', () => {
  const res = postWebhook({ id: 'evt_forged' });
  assert.equal(res.success, false);
  assert.match(res.error, /verification failed/);
});

test('handleStripeWebhook: eventId無しはエラー', () => {
  const res = postWebhook({});
  assert.equal(res.success, false);
  assert.equal(res.error, 'no event id');
});

test('handleStripeWebhook: 未対応のイベント種別は成功扱いで無視する', () => {
  const eventId = 'evt_test_other';
  registerStripeEvent({ id: eventId, type: 'customer.created', data: { object: {} } });
  const res = postWebhook({ id: eventId });
  assert.equal(res.success, true);
});

test('handleStripeWebhook: handleCheckoutCompletedが例外を投げた場合、冪等フラグを立てず再送で成功する', () => {
  const eventId = 'evt_test_retry';
  const sessionId = 'cs_test_retry';
  registerStripeEvent({
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: { id: sessionId, mode: 'payment', payment_status: 'paid', amount_total: 300 } },
  });

  // handleCheckoutCompletedを一時的に例外を投げる実装に差し替える
  const originalHandleCheckoutCompleted = vm.runInContext('handleCheckoutCompleted', sandbox);
  vm.runInContext('handleCheckoutCompleted = function() { throw new Error("simulated failure"); }', sandbox);

  const failed = postWebhook({ id: eventId });
  assert.equal(failed.success, false);
  assert.equal(failed.error, 'simulated failure');

  const cache = vm.runInContext('CacheService.getScriptCache()', sandbox);
  assert.equal(
    cache.get('stripe_evt_' + eventId),
    null,
    '副作用が失敗した場合は冪等フラグを立ててはいけない（次回の再配信で再試行できるようにするため）'
  );

  // 元の実装に戻して同じイベントを再送
  sandbox.handleCheckoutCompleted = originalHandleCheckoutCompleted;
  const retried = postWebhook({ id: eventId });
  assert.equal(retried.success, true, '失敗後の再送は(duplicate扱いされず)成功するはず');

  const claimRes = post({ action: 'claim_code', session_id: sessionId });
  assert.equal(claimRes.success, true);
  assert.match(claimRes.code, /^[A-Z0-9]{8}$/);
});
