# 合言葉発行のStripe買い切り決済化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現状 `auth: 'none'` で誰でも無料・無制限に発行できる合言葉(`issue_code`)を、Stripe買い切り決済(¥300)完了後にのみ発行される仕組みに置き換える。

**Architecture:** Stripe Payment Linksへの遷移で決済し、決済完了WebhookがGAS backend側で合言葉を発行してCacheServiceに一時保存する。新設する `payment-complete.html` がポーリングでその合言葉を取得して表示する。NEXUA本体(`/Users/blackcoffee/WEB/XYZ/meisi/gas_backend.js`)のStripe連携パターン(イベントID実在確認・冪等化・LockService排他・HtmlServiceでの302回避)をそのまま踏襲する。

**Tech Stack:** Google Apps Script(GAS Web App)、Stripe API、Node.js `vm`モジュールによるGASモックテスト(既存パターン踏襲)、素のHTML/JS(ビルド無し)

**Spec:** `docs/superpowers/specs/2026-08-23-meishi-bookmark-stripe-payment-design.md`

## Global Constraints

- 価格は¥300固定（買い切り、複数プランなし）
- 決済リンクは `https://buy.stripe.com/cNi4gy6kE5KAgNm0gidby0b`（作成済み、変更しない）
- 既存の無料`issue_code`は廃止し、合言葉発行の入口は決済後の`claim_code`のみにする
- Webhookレスポンスは`HtmlService.createHtmlOutput()`で返す（`ContentService`は302を挟みStripeのWebhook配信が失敗扱いになるため）
- Stripeの署名ヘッダーはGASの`doPost`では読めないため、受信イベントIDをStripe API(`GET /v1/events/{id}`)に照会して実在確認する方式で真正性を担保する
- 全てのGAS backend変更後は `npm test` (プロジェクトルートで実行、`node --test $(find src gas-backend -name '*.test.js')`)を通す
- HTML変更後は `node --check` で対象`<script type="module">`ブロックの構文チェックを行う（既存セッションの手順: `grep -n '<script type="module">\|</script>'`で行番号を特定し`sed -n 'START,ENDp'`で抽出してcheck）
- コミットは1タスク1コミット。pushしたら`gh api repos/laxuz999/meishi-bookmark/commits/main --jq '.sha'`で独立確認し、CIの`test`→`deploy`ジョブが両方successになるまで`gh run list`で確認する
- GAS backend側の変更は`clasp push --force`＋`clasp deploy --deploymentId AKfycbyelJf8EEuEIWUiwrp2l8TFddL5jXemE-EKxDUeeJnQIxJpRsmPaaqh2eCHVLOXTEWj`で本番デプロイし、`clasp deployments`のバージョン番号をコミットメッセージ・報告に含める

---

## 現状のファイル構成（参考）

- `gas-backend/Code.gs` — バックエンド本体。`ROUTES`テーブルで`issue_code`/`get_bookmarks`/`save_bookmarks`をルーティング
- `gas-backend/backend.test.js` — `node:vm`でCode.gsをサンドボックス実行するテスト。`MockSheet`クラス、`post()`/`get()`ヘルパーあり
- `src/pocketApi.js` — フロント側のAPIクライアント。`issueCode()`/`getBookmarks()`/`saveBookmarks()`/`isPaperCard()`/`describeApiError()`をexport
- `src/pocketApi.test.js` — 上記のテスト
- `index.html` — 一覧画面。`pocketIssueBtn`クリックで`issueCode()`→合言葉表示モーダル、というフロー

---

### Task 1: GAS backend — Stripe API疎通用ヘルパーとテスト用UrlFetchAppモック基盤

**Files:**
- Modify: `gas-backend/Code.gs`
- Modify: `gas-backend/backend.test.js`

**Interfaces:**
- Produces: `getStripeApiKey(): string`, `stripeApiGet(path: string): object`（Stripe API GETのラッパー、非200でthrow）
- テスト側: `sandbox.UrlFetchApp.fetch(url, options)`モック、`mockStripeEvents`（テストから登録するイベントのマップ）、`scriptProps['STRIPE_API_KEY']`にダミー値を設定

- [ ] **Step 1: `gas-backend/Code.gs`の末尾に`getStripeApiKey`/`stripeApiGet`を追加**

`gas-backend/Code.gs`の末尾（`saveBookmarks`関数の後）に追記:

```js

// ── Stripe連携 ─────────────────────────────────────────────
// NEXUA本体(gas_backend.js)と同じ設計: Stripeの署名ヘッダーはGASのdoPostでは
// 読めないため、受信イベントIDをStripe APIに問い合わせて実在確認する方式で
// 真正性を担保する（受信ペイロードそのものは信用しない）
const STRIPE_PRICE_JPY = 300; // 買い切り価格（税込・円）

function getStripeApiKey() {
  return PropertiesService.getScriptProperties().getProperty('STRIPE_API_KEY') || '';
}

function stripeApiGet(path) {
  const key = getStripeApiKey();
  if (!key) throw new Error('STRIPE_API_KEY未設定（スクリプトプロパティを確認してください）');
  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/' + path, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 300) {
    throw new Error('Stripe API error: ' + ((body.error && body.error.message) || res.getContentText()));
  }
  return body;
}
```

- [ ] **Step 2: `gas-backend/backend.test.js`にUrlFetchAppモックと`STRIPE_API_KEY`を追加**

`gas-backend/backend.test.js`の`let sandbox;`宣言の直後に、同じくファイルトップレベルの変数として追加（`beforeEach`内の`const`にすると、後で追加するトップレベル関数`registerStripeEvent`から参照できないため、`sandbox`と同じ「トップレベルで`let`宣言→`beforeEach`内で再代入」のパターンにする）:

```js
let sandbox;
let mockStripeEvents; // eventId -> event object（テストから登録する「Stripeに実在するイベント」）
```

（元の`let sandbox;`の行を上記2行に置き換える）

`beforeEach`内の先頭、`const sheets = {};`の直前に追加:

```js
  mockStripeEvents = {};
```

同じ`beforeEach`内、`scriptProps`の宣言のすぐ下あたりに、STRIPE_API_KEYを事前設定する行を追加（`const scriptProps = {};`の直後）:

```js
  const scriptProps = {}; // PropertiesServiceが永続的に保存するデータ
  scriptProps['STRIPE_API_KEY'] = 'sk_test_dummy';
```

`sandbox`オブジェクトの`CacheService`定義の直後（`ContentService`定義の前）に、`UrlFetchApp`モックを追加:

```js
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
```

（`HtmlService`はTask 3で使うが、モック自体はここでまとめて追加しておく）

ファイル末尾（最後のtestブロックの後）に、テストヘルパーを追加:

```js

// テストから「Stripeに実在するイベント」を登録するヘルパー。
// stripeApiGet('events/'+id)のモック応答に使われる
function registerStripeEvent(event) {
  mockStripeEvents[event.id] = event;
}
```

- [ ] **Step 3: 疎通確認テストを追加**

`gas-backend/backend.test.js`の末尾（Step 2で追加した`registerStripeEvent`ヘルパーの前）にテストを追加:

```js
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
```

- [ ] **Step 4: テスト実行**

Run: `cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark && node --test gas-backend/backend.test.js`
Expected: 全件PASS（既存分 + 新規2件）

- [ ] **Step 5: Commit**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
git add gas-backend/Code.gs gas-backend/backend.test.js
git commit -m "feat: Stripe API疎通用ヘルパーとテスト用UrlFetchAppモックを追加

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: GAS backend — issueCode()の拡張とclaim_codeアクション

**Files:**
- Modify: `gas-backend/Code.gs`
- Modify: `gas-backend/backend.test.js`

**Interfaces:**
- Consumes: Task 1の`getStripeApiKey`/`stripeApiGet`（本タスクでは未使用、後続タスクで使用）
- Produces: `issueCode(stripeCustomerEmail?: string): {success:true, code:string}`（既存関数を拡張。第2引数追加、後方互換）、`claimCode(sessionId: string): {success:boolean, code?:string, error?:string, code_field?:string}`、`checkClaimRateLimit(sessionId: string): boolean`

- [ ] **Step 1: `issueCode()`にメールアドレス引数を追加**

`gas-backend/Code.gs`の既存の`issueCode`関数を置き換え:

```js
function issueCode(stripeCustomerEmail) {
  const sheet = getSheet();
  let code;
  do {
    code = generateCode();
  } while (findUserRow(code));
  sheet.appendRow([code, new Date().toISOString(), stripeCustomerEmail || '', '[]']);
  // 発行直後のget_bookmarks/save_bookmarksから全行スキャンせずに済むよう、
  // 行番号を先回りしてキャッシュしておく
  CacheService.getScriptCache().put(USER_ROW_CACHE_PREFIX + code, String(sheet.getLastRow()), USER_ROW_CACHE_TTL_SECONDS);
  return { success: true, code };
}
```

（変更点: 引数`stripeCustomerEmail`を追加し、シート3列目に`stripeCustomerEmail || ''`を書き込む。引数省略時は従来と同じ挙動）

- [ ] **Step 2: 失敗するテストを書く（issueCodeのメール引数）**

`gas-backend/backend.test.js`の末尾（`registerStripeEvent`ヘルパーの前）に追加:

```js
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
```

- [ ] **Step 3: テスト実行して通ることを確認**

Run: `node --test gas-backend/backend.test.js`
Expected: 全件PASS（Step 1の実装が既にあるため最初からPASSするはず。TDDの「先に失敗を見る」目的では、Step 1を適用する前に一度実行してFAILすることを確認してから戻ってStep 1を当てても良い）

- [ ] **Step 4: `claim_code`のバックエンド関数を追加**

`gas-backend/Code.gs`の`stripeApiGet`関数の直後に追記:

```js

// 決済完了WebhookがCacheServiceに一時保存した合言葉を、Stripe CheckoutのセッションID
// をキーに取り出す。フロント(payment-complete.html)がポーリングで呼ぶ想定
const CLAIM_CODE_CACHE_PREFIX = 'claim_';
const CLAIM_CODE_CACHE_TTL_SECONDS = 3600; // 1時間

// claim_codeはauth:'none'（session_id自体が秘密情報の代わり）のため、
// 通常のcheckRateLimit(合言葉ごと)とは別に、ポーリング用の緩やかな制限を設ける
const CLAIM_RATE_LIMIT_MAX_PER_WINDOW = 60;
const CLAIM_RATE_LIMIT_WINDOW_SECONDS = 60;

function checkClaimRateLimit(sessionId) {
  const cache = CacheService.getScriptCache();
  const key = 'claim_rl_' + sessionId;
  const count = Number(cache.get(key) || '0') + 1;
  cache.put(key, String(count), CLAIM_RATE_LIMIT_WINDOW_SECONDS);
  return count <= CLAIM_RATE_LIMIT_MAX_PER_WINDOW;
}

function claimCode(sessionId) {
  if (!sessionId) return { success: false, error: 'session_idが必要です', code: 'BAD_REQUEST' };
  if (!checkClaimRateLimit(sessionId)) {
    return { success: false, error: 'アクセスが集中しています。しばらくしてからお試しください', code: 'RATE_LIMITED' };
  }
  const code = CacheService.getScriptCache().get(CLAIM_CODE_CACHE_PREFIX + sessionId);
  if (!code) {
    return { success: false, error: '決済の確認中です。少し待ってからもう一度お試しください', code: 'PENDING' };
  }
  return { success: true, code };
}
```

- [ ] **Step 5: `ROUTES`から`issue_code`を削除し`claim_code`を追加**

`gas-backend/Code.gs`の`ROUTES`定義を置き換え:

```js
const ROUTES = {
  claim_code: { auth: 'none', write: false, handler: (p) => claimCode(p.session_id) },
  get_bookmarks: { auth: 'code', write: false, handler: (p) => getBookmarks(p.code) },
  save_bookmarks: { auth: 'code', write: true, handler: (p) => saveBookmarks(p.code, p.bookmarks) },
};
```

- [ ] **Step 6: claim_codeのテストを追加**

`gas-backend/backend.test.js`の末尾に追加:

```js
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
```

- [ ] **Step 7: テスト実行**

Run: `node --test gas-backend/backend.test.js`
Expected: 全件PASS

注意: この時点では既存の`post({action:'issue_code'})`を使う既存テスト群がまだ残っており、`issue_code`は`ROUTES`から削除済みなので**それらは`UNKNOWN_ACTION`エラーになりFAILする**。これは想定内（Task 4でまとめて置き換える）。Step 7では新規追加分のテスト（claim_code関連、issueCode関連）だけが対象通りPASSすることを、失敗一覧に新規テスト名が含まれていないことで確認する。

- [ ] **Step 8: Commit**

```bash
git add gas-backend/Code.gs gas-backend/backend.test.js
git commit -m "feat: issueCodeにメール引数を追加しclaim_codeアクションを新設

issue_codeはROUTESから削除済み（既存テストの書き換えは次コミットで
まとめて行うため、この時点では意図的に一部テストがFAILする）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: GAS backend — Webhook処理（handleCheckoutCompleted・handleStripeWebhook・doPost分岐）

**Files:**
- Modify: `gas-backend/Code.gs`
- Modify: `gas-backend/backend.test.js`

**Interfaces:**
- Consumes: Task 1の`stripeApiGet`、Task 2の`issueCode(email)`、`CLAIM_CODE_CACHE_PREFIX`、`CLAIM_CODE_CACHE_TTL_SECONDS`、`STRIPE_PRICE_JPY`
- Produces: `handleCheckoutCompleted(session: object): void`、`handleStripeWebhook(raw: object): {success:boolean, error?:string, skipped?:string}`、`webhookResponse(obj: object)`（HtmlService版レスポンス）。`doPost`が`e.parameter.stripe_webhook`で分岐する

- [ ] **Step 1: `webhookResponse`と`handleCheckoutCompleted`を追加**

`gas-backend/Code.gs`の`claimCode`関数の直後に追記:

```js

function webhookResponse(obj) {
  // GAS Web AppはContentServiceで返すと必ず302リダイレクトを1回挟む仕様があり、
  // StripeのWebhook配信はリダイレクトを追わず「失敗」扱いにするため、
  // Webhook応答限定でHtmlServiceを使う（NEXUA本体gas_backend.jsと同じ対策）
  return HtmlService.createHtmlOutput(JSON.stringify(obj));
}

// 買い切り(mode:'payment')の決済完了イベントのみを処理する。
// サブスク(mode:'subscription')は対象外（このプロジェクトでは扱わない）
function handleCheckoutCompleted(session) {
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return;
  if (session.amount_total !== STRIPE_PRICE_JPY) return; // 想定外金額は無視（不正対策）
  const email = (session.customer_details && session.customer_details.email) || '';
  const result = issueCode(email);
  CacheService.getScriptCache().put(CLAIM_CODE_CACHE_PREFIX + session.id, result.code, CLAIM_CODE_CACHE_TTL_SECONDS);
}
```

- [ ] **Step 2: `handleCheckoutCompleted`単体のテストを追加**

`gas-backend/backend.test.js`の末尾に追加:

```js
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
```

- [ ] **Step 3: テスト実行**

Run: `node --test gas-backend/backend.test.js`
Expected: Step 2で追加した4件がPASS

- [ ] **Step 4: `handleStripeWebhook`を追加**

`gas-backend/Code.gs`の`handleCheckoutCompleted`関数の直後に追記:

```js

// Webhook本体: 冪等化 → Stripe APIで実在確認 → ロックして反映
// （NEXUA本体gas_backend.jsのhandleStripeWebhookと同じ設計）
function handleStripeWebhook(raw) {
  const eventId = raw && raw.id;
  if (!eventId) return { success: false, error: 'no event id' };

  const cache = CacheService.getScriptCache();
  const dedupeKey = 'stripe_evt_' + eventId;
  if (cache.get(dedupeKey)) return { success: true, skipped: 'duplicate' };

  let event;
  try {
    event = stripeApiGet('events/' + eventId);
  } catch (err) {
    return { success: false, error: 'verification failed: ' + err.message };
  }
  if (!event || event.id !== eventId) {
    return { success: false, error: 'event verification mismatch' };
  }

  cache.put(dedupeKey, '1', 21600); // 6時間（CacheServiceの最大保持時間）

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20 * 1000)) return { success: false, error: 'busy' };
  try {
    if (event.type === 'checkout.session.completed') {
      handleCheckoutCompleted(event.data.object);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 5: `doPost`にWebhook分岐を追加**

`gas-backend/Code.gs`の`doPost`関数を置き換え:

```js
function doPost(e) {
  let p;
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: 'invalid JSON', code: 'BAD_REQUEST' });
  }
  // Stripe Webhook（URLクエリ ?stripe_webhook=1 で判別。ROUTESとは別処理・action不要）
  // 302リダイレクト回避のためwebhookResponse(HtmlService)で返す
  if (e.parameter && e.parameter.stripe_webhook) {
    return webhookResponse(handleStripeWebhook(p));
  }
  return handle(p);
}
```

- [ ] **Step 6: Webhook経由のE2Eテストを追加**

`gas-backend/backend.test.js`に、`doPost`をWebhookモードで呼ぶヘルパーと、E2Eテストを追加。ファイル内の`function get(params)`の直後に追記:

```js

// Stripe Webhookを模したdoPost呼び出し（?stripe_webhook=1相当）
function postWebhook(payload) {
  const doPost = vm.runInContext('doPost', sandbox);
  const result = doPost({ postData: { contents: JSON.stringify(payload) }, parameter: { stripe_webhook: '1' } });
  assert.equal(result._isHtml, true, 'Webhook応答はHtmlServiceで返るはず(302回避)');
  return JSON.parse(result._t);
}
```

ファイル末尾に追加:

```js
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
```

- [ ] **Step 7: テスト実行**

Run: `node --test gas-backend/backend.test.js`
Expected: Step 6で追加した5件がPASS。既存の`issue_code`依存テストは引き続きFAILしたままで想定内（Task 4で解消）

- [ ] **Step 8: Commit**

```bash
git add gas-backend/Code.gs gas-backend/backend.test.js
git commit -m "feat: Stripe Webhook処理(冪等化・実在確認・ロック)を追加

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: GAS backend — 既存テストをclaim_codeベースに全面置き換え

**Files:**
- Modify: `gas-backend/backend.test.js`

**Interfaces:**
- Consumes: Task 2/3で追加した`claim_code`、`postWebhook`、`registerStripeEvent`

このタスクはコード追加ではなく、Task 2で意図的に壊れたままにしていた既存テストを、決済フロー経由のヘルパーに置き換える作業。

- [ ] **Step 1: テストヘルパー`issueTestCode()`を追加**

`gas-backend/backend.test.js`の`postWebhook`関数の直後に追記:

```js

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
```

- [ ] **Step 2: 既存テストを置き換える**

以下の既存テストを、`post({ action: 'issue_code' })`から`issueTestCode()`ベースに書き換える。`gas-backend/backend.test.js`内の該当テストをそれぞれ以下の内容で置き換えること。

`test('issue_code: 8桁の合言葉を発行する', ...)` と `test('issue_code: 紛らわしい文字(0,O,1,I)を含まない', ...)` は**削除**する（Task 1で`issueCode()`関数自体の直接テストとして既にカバー済みのため重複）。

`test('get_bookmarks: 発行直後は空配列を返す', ...)` を置き換え:

```js
test('get_bookmarks: 発行直後は空配列を返す', () => {
  const code = issueTestCode();
  const res = post({ action: 'get_bookmarks', code });
  assert.equal(res.success, true);
  assert.deepEqual(res.bookmarks, []);
});
```

`test('save_bookmarks → get_bookmarksで保存した内容がそのまま読める', ...)` を置き換え:

```js
test('save_bookmarks → get_bookmarksで保存した内容がそのまま読める', () => {
  const code = issueTestCode();
  const bookmarks = [{ url: 'https://nexua.tech/#zz1', name: '山田', tags: ['DIY'], memo: '展示会で交換' }];
  const saveRes = post({ action: 'save_bookmarks', code, bookmarks });
  assert.equal(saveRes.success, true);
  const getRes = post({ action: 'get_bookmarks', code });
  assert.deepEqual(getRes.bookmarks, bookmarks);
});
```

`test('save_bookmarksは前回の内容を上書きする（追記ではない）', ...)` を置き換え:

```js
test('save_bookmarksは前回の内容を上書きする（追記ではない）', () => {
  const code = issueTestCode();
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'a', name: '1件目' }] });
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'b', name: '2件目' }] });
  const res = post({ action: 'get_bookmarks', code });
  assert.equal(res.bookmarks.length, 1);
  assert.equal(res.bookmarks[0].name, '2件目');
});
```

`test('save_bookmarks: 件数上限(MAX_BOOKMARKS_COUNT)を超えるとTOO_MANY_BOOKMARKSエラー', ...)` を置き換え（先頭の`const { code } = post({ action: 'issue_code' });`を`const code = issueTestCode();`に変更するだけ、以降は変更なし）:

```js
test('save_bookmarks: 件数上限(MAX_BOOKMARKS_COUNT)を超えるとTOO_MANY_BOOKMARKSエラー', () => {
  const code = issueTestCode();
  const MAX = vm.runInContext('MAX_BOOKMARKS_COUNT', sandbox);
  const tooMany = Array.from({ length: MAX + 1 }, (_, i) => ({ url: `u${i}`, name: `n${i}` }));
  const res = post({ action: 'save_bookmarks', code, bookmarks: tooMany });
  assert.equal(res.success, false);
  assert.equal(res.code, 'TOO_MANY_BOOKMARKS');
  const getRes = post({ action: 'get_bookmarks', code });
  assert.deepEqual(getRes.bookmarks, []);
});
```

`test('save_bookmarks: 件数上限ちょうどは保存できる（境界値）', ...)` を置き換え:

```js
test('save_bookmarks: 件数上限ちょうどは保存できる（境界値）', () => {
  const code = issueTestCode();
  const MAX = vm.runInContext('MAX_BOOKMARKS_COUNT', sandbox);
  const exactly = Array.from({ length: MAX }, (_, i) => ({ url: `u${i}`, name: `n${i}` }));
  const res = post({ action: 'save_bookmarks', code, bookmarks: exactly });
  assert.equal(res.success, true);
});
```

`test('save_bookmarks: JSON文字数上限(MAX_BOOKMARKS_JSON_LENGTH)を超えるとPAYLOAD_TOO_LARGEエラー', ...)` を置き換え:

```js
test('save_bookmarks: JSON文字数上限(MAX_BOOKMARKS_JSON_LENGTH)を超えるとPAYLOAD_TOO_LARGEエラー', () => {
  const code = issueTestCode();
  const hugeMemo = 'x'.repeat(60000);
  const res = post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'a', name: 'n', memo: hugeMemo }] });
  assert.equal(res.success, false);
  assert.equal(res.code, 'PAYLOAD_TOO_LARGE');
});
```

`test('save_bookmarks: bookmarksが配列でない場合はエラーを返し、既存データは消さない', ...)` を置き換え:

```js
test('save_bookmarks: bookmarksが配列でない場合はエラーを返し、既存データは消さない', () => {
  const code = issueTestCode();
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'a', name: '既存データ' }] });
  const res = post({ action: 'save_bookmarks', code, bookmarks: 'not-an-array' });
  assert.equal(res.success, false);
  assert.equal(res.code, 'INVALID_PAYLOAD');
  const getRes = post({ action: 'get_bookmarks', code });
  assert.equal(getRes.bookmarks.length, 1);
  assert.equal(getRes.bookmarks[0].name, '既存データ');
});
```

`test('findUserRow: issue_code直後はキャッシュ済みのため、get_bookmarksで全行スキャンが発生しない', ...)` を置き換え:

```js
test('findUserRow: 合言葉発行直後はキャッシュ済みのため、get_bookmarksで全行スキャンが発生しない', () => {
  const code = issueTestCode();
  const sheet = vm.runInContext('getSheet()', sandbox);
  const scanBefore = sheet.rangeScanCount;
  const res = post({ action: 'get_bookmarks', code });
  assert.equal(res.success, true);
  assert.equal(sheet.rangeScanCount, scanBefore, '発行時点でキャッシュ済みのためスキャンなしでヒットするはず');
});
```

`test('レート制限: 同じ合言葉への短時間の大量アクセスはRATE_LIMITEDエラー', ...)` を置き換え:

```js
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
```

`test('レート制限: save_bookmarks(write系)にもかかる', ...)` を置き換え:

```js
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
```

`test('レート制限: 合言葉ごとに別々にカウントされる（片方が制限されてももう片方は影響しない）', ...)` を置き換え:

```js
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
```

`test('doGET: issue_code（write系）はMETHOD_NOT_ALLOWEDエラー', ...)` は**削除**する（`issue_code`アクション自体が存在しなくなったため）。

`test('doGET: get_bookmarks（read系）はPOSTと同じく動作可能', ...)` を置き換え:

```js
test('doGET: get_bookmarks（read系）はPOSTと同じく動作可能', () => {
  const code = issueTestCode();
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'test', name: 'テスト' }] });
  const res = get({ action: 'get_bookmarks', code });
  assert.equal(res.success, true);
  assert.equal(res.bookmarks.length, 1);
  assert.equal(res.bookmarks[0].name, 'テスト');
});
```

- [ ] **Step 3: 全テスト実行**

Run: `node --test gas-backend/backend.test.js`
Expected: 全件PASS（`issue_code`関連の削除2件を除き、既存のテスト意図は全て保持したままPASSする）

- [ ] **Step 4: プロジェクト全体のテストも実行**

Run: `cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark && npm test`
Expected: 全件PASS

- [ ] **Step 5: Commit**

```bash
git add gas-backend/backend.test.js
git commit -m "test: 既存テストをissue_codeからStripe決済フロー(claim_code)ベースに置き換え

issue_codeアクション廃止に伴い、テストのセットアップを
issueTestCode()ヘルパー(Webhook経由での合言葉発行)に統一。
テストの意図・アサーション内容は変更していない。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: GAS backendを本番デプロイ**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
git push
gh api repos/laxuz999/meishi-bookmark/commits/main --jq '.sha'
gh run list --repo laxuz999/meishi-bookmark --limit 1 --json status,conclusion,headSha
# ↑成功するまで数回繰り返し確認（test→deployの順で走る）
cd gas-backend
clasp push --force
clasp deploy --deploymentId AKfycbyelJf8EEuEIWUiwrp2l8TFddL5jXemE-EKxDUeeJnQIxJpRsmPaaqh2eCHVLOXTEWj --description "pocket backend v8 (Stripe payment)"
```

Expected: `clasp deploy`が新しいバージョン番号（v7の次、@11想定）を出力する

**注意（この時点でのユーザー影響）:** ここまでデプロイすると、本番の`issue_code`は既に存在しない。まだ`index.html`側は旧コード（`issueCode()`呼び出し）のままなので、**Task 6でindex.htmlを更新するまでの間、一覧画面の「合言葉を発行して他の端末とも同期する」ボタンは動作しなくなる**（UNKNOWN_ACTIONエラー）。Task 6まで連続して進めるか、または一時的にメンテナンス状態になることを許容できるタイミングで進めること。

---

### Task 5: フロントエンド — `src/pocketApi.js`の`claimCode`追加・`issueCode`削除

**Files:**
- Modify: `src/pocketApi.js`
- Modify: `src/pocketApi.test.js`

**Interfaces:**
- Produces: `claimCode(sessionId: string): Promise<{success:boolean, code?:string, error?:string, code_field?:string}>`
- Removes: `issueCode()`のexport

- [ ] **Step 1: 失敗するテストを書く**

`src/pocketApi.test.js`の`import`行を更新:

```js
import { getBookmarks, saveBookmarks, isPaperCard, describeApiError, claimCode } from './pocketApi.js';
```

（`issueCode`をimportから削除、`claimCode`を追加）

`test('issueCode: ...')`系の2テスト（`'issueCode: action=issue_codeをPOSTし、結果をそのまま返す'`と`'issueCode: Content-Typeはtext/plain（CORSプリフライト回避のため）'`）を削除し、代わりにファイル内の`saveBookmarks`テストの直後に追加:

```js
test('claimCode: session_idを渡してaction=claim_codeをPOSTする', async () => {
  const res = await claimCode('cs_test_abc');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.action, 'claim_code');
  assert.equal(body.session_id, 'cs_test_abc');
});
```

`beforeEach`内のモック`fetch`に、`claim_code`アクションへの応答を追加（`if (body.action === 'save_bookmarks') ...`の直後）:

```js
    if (body.action === 'claim_code') return { json: async () => ({ success: true, code: 'ZZYYXXWW' }) };
```

- [ ] **Step 2: テスト実行して失敗を確認**

Run: `node --test src/pocketApi.test.js`
Expected: FAIL（`claimCode is not defined` / `issueCode is not exported`等）

- [ ] **Step 3: `src/pocketApi.js`を修正**

`export function issueCode() { ... }`ブロックを削除し、代わりに追加:

```js
export function claimCode(sessionId) {
  return callApi({ action: 'claim_code', session_id: sessionId });
}
```

- [ ] **Step 4: テスト実行して通ることを確認**

Run: `node --test src/pocketApi.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pocketApi.js src/pocketApi.test.js
git commit -m "feat: pocketApiにclaimCodeを追加しissueCodeを削除

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: フロントエンド — `index.html`のボタン導線変更とpayment-complete.html新規作成

**Files:**
- Modify: `index.html`
- Create: `payment-complete.html`

**Interfaces:**
- Consumes: Task 5の`claimCode(sessionId)`
- `index.html`の「合言葉を発行して他の端末とも同期する」ボタンが`https://buy.stripe.com/cNi4gy6kE5KAgNm0gidby0b`へ遷移するようになる

- [ ] **Step 1: `index.html`のimportを更新**

`import { issueCode, getBookmarks, saveBookmarks, isPaperCard, describeApiError } from './src/pocketApi.js?v=20260823d';`を以下に置き換え:

```js
    import { getBookmarks, saveBookmarks, isPaperCard, describeApiError } from './src/pocketApi.js?v=20260823e';
```

（`issueCode`のimportを削除、バージョンクエリを更新）

- [ ] **Step 2: 合言葉発行モーダル関連のHTML・DOM参照・イベントリスナーを削除**

`<div id="pocket-code-shown-modal" ...>...</div>`ブロック全体（`index.html`内、`pocket-choice-modal`の直後にある）を削除する。

`const pocketCodeShownModal = document.getElementById('pocket-code-shown-modal');`から`const pocketCodeInputOk = document.getElementById('pocket-code-input-ok');`の間にある、以下の4行を削除:

```js
    const pocketCodeShownModal = document.getElementById('pocket-code-shown-modal');
    const pocketCodeDisplay = document.getElementById('pocket-code-display');
    const pocketCodeCopyBtn = document.getElementById('pocket-code-copy-btn');
    const pocketCodeShownOk = document.getElementById('pocket-code-shown-ok');
```

`let pendingIssuedCode = null;`とそのコメント行を削除。

- [ ] **Step 3: `pocketIssueBtn`のクリックハンドラをStripe Payment Linksへの遷移に変更**

既存の`pocketIssueBtn.addEventListener('click', async () => { ... });`ブロックを置き換え:

```js
    pocketIssueBtn.addEventListener('click', async () => {
      pocketChoiceModal.style.display = 'none';
      // 既に合言葉を発行・入力済みの場合、無警告で切り替えると今のデータと
      // 切り離されてしまうため、事前に確認する
      if (getSavedPocketCode()) {
        const proceed = await appConfirm('既に合言葉があります。新しく発行すると今のデータと切り離されます。よろしいですか？');
        if (!proceed) return;
      }
      location.href = 'https://buy.stripe.com/cNi4gy6kE5KAgNm0gidby0b';
    });
```

- [ ] **Step 4: `pocketCodeCopyBtn`/`pocketCodeShownOk`のイベントリスナーを削除**

以下の2ブロックを削除（機能ごと`payment-complete.html`に移るため）:

```js
    pocketCodeCopyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pocketCodeDisplay.textContent);
        pocketCodeCopyBtn.textContent = '✓ コピーしました';
        setTimeout(() => {
          pocketCodeCopyBtn.textContent = '📋 コピーする';
        }, 2000);
      } catch (err) {
        await appAlert('コピーできませんでした。手動で書き写してください。');
      }
    });
    pocketCodeShownOk.addEventListener('click', async () => {
      pocketCodeShownModal.style.display = 'none';
      await syncWithPocketCode(pendingIssuedCode);
      pendingIssuedCode = null;
    });
```

- [ ] **Step 5: 構文チェック**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
grep -n '<script type="module">\|</script>' index.html
```

出た開始行・終了行を使い、スクラッチパッドディレクトリに抽出してチェック（例、実際の行番号に置き換える）:

```bash
SCRATCH=/private/tmp/claude-502/-Users-blackcoffee/8308168a-db99-4e85-a608-cdb71b77eb4a/scratchpad
sed -n 'START,ENDp' index.html > "$SCRATCH/idx_check.mjs" && node --check "$SCRATCH/idx_check.mjs" && echo OK
```

Expected: `OK`

- [ ] **Step 6: `payment-complete.html`を新規作成**

以下の内容で`payment-complete.html`を作成:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>決済完了 - NEXUA名刺ポケット</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif;
      background: linear-gradient(160deg, #fff7ed 0%, #fef3f2 35%, #eff6ff 70%, #f0fdfa 100%);
    }
  </style>
</head>
<body class="min-h-screen text-neutral-800">
  <div class="max-w-md mx-auto px-6 py-12">
    <h1 class="text-lg font-bold text-center text-neutral-800 mb-6 tracking-tight">🔑 合言葉の発行</h1>

    <div id="waiting-ui" class="bg-white/70 backdrop-blur border border-neutral-200 rounded-2xl p-6 text-sm leading-relaxed text-center">
      <p id="waiting-message">決済を確認しています...</p>
    </div>

    <div id="code-ui" style="display:none" class="bg-white/70 backdrop-blur border border-neutral-200 rounded-2xl p-6 text-sm leading-relaxed text-center">
      <h3 class="font-bold text-base mb-3">🔑 合言葉が発行されました</h3>
      <p id="code-display" class="text-2xl font-mono font-bold tracking-widest my-4 text-rose-500"></p>
      <button id="code-copy-btn" class="w-full mb-3 py-2 rounded-xl border border-rose-200 text-rose-500 font-semibold text-xs hover:bg-rose-50 transition-colors">📋 コピーする</button>
      <p class="text-xs text-neutral-500 mb-4">この合言葉を控えておいてください。他の端末で入力すると、同じ名刺一覧が見られます。忘れると復元できません。</p>
      <a id="code-go-to-list" href="./" class="block w-full py-2.5 rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 text-white font-bold text-sm shadow-md text-center">一覧画面へ</a>
    </div>

    <div id="error-ui" style="display:none" class="bg-white/70 backdrop-blur border border-neutral-200 rounded-2xl p-6 text-sm leading-relaxed text-center">
      <p id="error-message"></p>
      <a href="./" class="inline-block mt-4 text-rose-500 underline text-xs">一覧画面へもどる</a>
    </div>
  </div>

  <script type="module">
    import { claimCode } from './src/pocketApi.js?v=20260823e';

    const POCKET_CODE_KEY = 'meishi_pocket_code';
    const waitingUi = document.getElementById('waiting-ui');
    const waitingMessage = document.getElementById('waiting-message');
    const codeUi = document.getElementById('code-ui');
    const codeDisplay = document.getElementById('code-display');
    const codeCopyBtn = document.getElementById('code-copy-btn');
    const errorUi = document.getElementById('error-ui');
    const errorMessage = document.getElementById('error-message');

    const sessionId = new URLSearchParams(location.search).get('session_id');

    const POLL_INTERVAL_MS = 2000;
    const POLL_MAX_ATTEMPTS = 30; // 2秒×30回 = 最大60秒待つ

    async function poll() {
      if (!sessionId) {
        errorMessage.textContent = '決済情報が見つかりません。決済リンクからやり直してください。';
        waitingUi.style.display = 'none';
        errorUi.style.display = 'block';
        return;
      }
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        const res = await claimCode(sessionId);
        if (res.success) {
          // 合言葉が確実に取得できた時点で初めてlocalStorageに保存する
          // （index.htmlの既存方針: 検証成功までは書き込まない、を踏襲）
          localStorage.setItem(POCKET_CODE_KEY, res.code);
          codeDisplay.textContent = res.code;
          waitingUi.style.display = 'none';
          codeUi.style.display = 'block';
          return;
        }
        if (res.code !== 'PENDING') {
          errorMessage.textContent = res.error || '合言葉の取得に失敗しました。';
          waitingUi.style.display = 'none';
          errorUi.style.display = 'block';
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      waitingMessage.textContent = '決済は完了していますが、合言葉の準備に時間がかかっています。少し時間を置いてこのページを再読み込みしてください。';
    }

    codeCopyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(codeDisplay.textContent);
        codeCopyBtn.textContent = '✓ コピーしました';
        setTimeout(() => { codeCopyBtn.textContent = '📋 コピーする'; }, 2000);
      } catch (err) {
        // クリップボード権限が無い環境でも合言葉は画面に表示されているため、
        // ボタンの見た目だけ変えず静かに失敗させる（手動でも書き写せる）
      }
    });

    poll();
  </script>
</body>
</html>
```

- [ ] **Step 7: `payment-complete.html`の構文チェック**

```bash
grep -n '<script type="module">\|</script>' payment-complete.html
```

出た行番号で同様に`sed`抽出→`node --check`。Expected: `OK`

- [ ] **Step 8: プロジェクト全体のテスト実行**

Run: `npm test`
Expected: 全件PASS

- [ ] **Step 9: Commit**

```bash
git add index.html payment-complete.html
git commit -m "feat: 合言葉発行をStripe決済経由に変更しpayment-complete.htmlを新設

index.htmlの「合言葉を発行して他の端末とも同期する」ボタンを
issueCode()の直接呼び出しから、Stripe Payment Linksへの遷移に変更。
決済完了後の合言葉受け渡しは新設のpayment-complete.htmlが
claim_codeをポーリングして自動表示する。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 10: push・デプロイ確認**

```bash
git push
gh api repos/laxuz999/meishi-bookmark/commits/main --jq '.sha'
gh run list --repo laxuz999/meishi-bookmark --limit 1 --json status,conclusion,headSha
# ↑test→deployが両方successになるまで確認
```

---

### Task 7: 運用セットアップ（コード外の手動作業・ドキュメント化）

**Files:**
- Modify: `docs/superpowers/specs/2026-08-23-meishi-bookmark-stripe-payment-design.md`（変更履歴・セットアップ手順追記）
- Modify: `README.md`

このタスクはコード変更を伴わない。実装完了後、本番で決済フローが動くようにするための手動セットアップの実施と記録。

- [ ] **Step 1: Stripeダッシュボードで`STRIPE_API_KEY`を用意しGASスクリプトプロパティに設定**

制限付きAPIキー（Events読取権限のみで十分）を発行し、GASエディタの「プロジェクトの設定」→「スクリプト プロパティ」で`STRIPE_API_KEY`として設定する（コミット・pushはしない、秘密情報のため）。

- [ ] **Step 2: GASエディタから`script.external_request`スコープを承認**

Web App経由では権限承認ダイアログを出せないため、GASエディタから`stripeApiGet('events/dummy')`相当の関数（例えば一時的に`checkStripeConnection`という疎通確認関数を追加してエディタから手動実行）を実行し、外部リクエストの権限承認ダイアログを通す。NEXUA本体の`checkStripeConnection`と同じ要領。

- [ ] **Step 3: Stripeダッシュボードでこの決済リンクの「決済後の遷移」設定を変更**

決済リンク`https://buy.stripe.com/cNi4gy6kE5KAgNm0gidby0b`の管理画面で、「After payment」設定を、`https://laxuz999.github.io/meishi-bookmark/payment-complete.html?session_id={CHECKOUT_SESSION_ID}`へのリダイレクトに変更する。

- [ ] **Step 4: Stripeダッシュボードでこの決済リンク用のWebhookエンドポイントを登録**

URL: `{GAS Web AppのデプロイURL}?stripe_webhook=1`
イベント: `checkout.session.completed`

- [ ] **Step 5: usersシートをリセットする**

GASエディタから、`getSheet()`を呼んでシートの全行（ヘッダー除く）を削除する一時操作を手動実行する。例えばエディタの実行パネルで以下を1回だけ実行:

```js
function resetUsersSheetOnce() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
}
```

（このコードは一時的な手動実行用であり、`Code.gs`には追加しない。実行後、この関数はエディタ上でも削除して構わない）

- [ ] **Step 6: 実機で決済〜合言葉受け取りのE2E確認**

実際に¥300決済し、`payment-complete.html`で合言葉が表示されること、一覧画面で同期が成功することを確認する（テスト用の少額決済。返金ポリシーは無しのため、テスト決済であることを事前に運営内で認識しておく）。

- [ ] **Step 7: 仕様書に運用セットアップ手順と完了を記録**

`docs/superpowers/specs/2026-08-23-meishi-bookmark-stripe-payment-design.md`の「変更履歴」セクションに、実施したセットアップ内容（Step 1〜6の結果）を追記する。

- [ ] **Step 8: README.mdを更新**

「オプション（合言葉方式）」の説明を、¥300の買い切り決済が必要である旨に更新する。

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-08-23-meishi-bookmark-stripe-payment-design.md README.md
git commit -m "docs: Stripe決済セットアップ手順と運用開始を記録

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push
```

---

## Self-Review Notes（このプランの作成時点でのチェック結果）

- **Spec coverage**: 設計書の「全体フロー」「GAS backend側の変更」「フロントエンド側の変更」「非対象」の各項目に対応するタスクを用意した。「非対象(YAGNI)」の項目（返金・領収書・サブスク化・複数プラン）は実装しないこと自体が要件なので対応タスクなし
- **Type/命名の一貫性**: `claim_code`アクション名、`claimCode()`関数名、`session_id`パラメータ名をTask 2〜6全体で統一。`CLAIM_CODE_CACHE_PREFIX`/`CLAIM_RATE_LIMIT_*`等の定数名もTask間で一致させた
- **Placeholder scan**: 各Stepのコードは実際に貼り付け可能な完全なコードとして記載（TODO/TBD無し）
- **既知のリスク**: Task 4のStep 6でGAS backendをデプロイした直後、Task 6完了までの間は本番の合言葉発行導線が一時的に機能しない（`issue_code`削除済み・`index.html`側は未更新のため）。Task 4〜6は同一セッションで連続して完了させることを推奨する
