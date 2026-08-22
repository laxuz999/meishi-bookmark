# 合言葉方式の同期基盤 実装計画（段階1: 土台）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google連携（同期・バックアップ）を廃止し、決済なしで動く「8桁の合言葉で他端末と同期する」仕組みの土台を作る（段階1のみ。決済は次の計画で追加）。

**Architecture:** 運営管理の新規Google Apps Script（開発者権限で実行）＋専用スプレッドシートをバックエンドとし、名刺のテキストデータ（url/name/tags/memo等）を合言葉ごとに1セルのJSONとして保存・取得する。クライアント側はfetchでこのGAS Web Appを呼ぶだけの薄いAPIモジュール(`src/pocketApi.js`)を新設し、既存のGoogle Identity Services経由の同期コード（トークンキャッシュ・サイレントログイン等）を削除する。紙の名刺・写真機能用のGoogle連携コード（`src/auth.js`のrequestLogin、`src/drive.js`）は今回は変更しない。

**Tech Stack:** Google Apps Script (V8 runtime, clasp deploy), Node.js `node:test`（GASコードはvmモジュールでロードしてテスト）, 既存のバニラJS + Tailwind CDN構成を踏襲

**Spec:** `docs/superpowers/specs/2026-08-22-meishi-bookmark-pin-auth-design.md`

## Global Constraints

- 合言葉は8桁、紛らわしい文字(`0`,`O`,`1`,`I`)を除いた英数字（仕様書「認証・合言葉まわり」より）
- GAS Web Appは実行者=開発者権限(`USER_DEPLOYING`)、アクセス可能ユーザー=全員(`ANYONE`)（NEXUA本体`gas_backend.js`と同じパターン、仕様書「GAS Web App API」より）
- fetchでGAS Web AppをPOSTする際は`Content-Type: text/plain`を使う（`application/json`だとプリフライトが必要になりGAS Web AppはCORSプリフライトに対応していないため、ブラウザ側でブロックされる）
- 名刺データは合言葉ごとに1セルのJSON文字列としてまとめて保存する（行展開しない。仕様書「データの持ち方」より）
- このタスクでは決済を実装しない。`issue_code`は誰でも呼べる仮実装のままにする（仕様書「段階1: 土台」より、段階2で決済を挟む）
- コミットメッセージ末尾に`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`を付ける

---

## Task 1: GAS backend — get_bookmarks/save_bookmarks/issue_codeの実装

**Files:**
- Create: `gas-backend/Code.gs`
- Create: `gas-backend/appsscript.json`
- Create: `gas-backend/backend.test.js`

**Interfaces:**
- Produces: GAS Web Appが受け付けるPOSTボディの形（後続タスクのpocketApi.jsが送信する形と一致させる）:
  - `{ action: 'issue_code' }` → `{ success: true, code: string }`
  - `{ action: 'get_bookmarks', code: string }` → `{ success: true, bookmarks: array }` または `{ success: false, error: string, code: 'CODE_INVALID' }`
  - `{ action: 'save_bookmarks', code: string, bookmarks: array }` → `{ success: true }` または `{ success: false, error: string, code: 'CODE_INVALID' }`
  - 未知のaction → `{ success: false, error: string, code: 'UNKNOWN_ACTION' }`

- [ ] **Step 1: appsscript.jsonを作成**

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE"
  }
}
```

保存先: `gas-backend/appsscript.json`

- [ ] **Step 2: 失敗するテストを書く（issue_code）**

`gas-backend/backend.test.js` を新規作成:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GASのSpreadsheetオブジェクトの最小モック（NEXUA本体 tests/gas_mock_test.cjs と同じ方針）
class MockSheet {
  constructor() { this.rows = []; }
  getDataRange() { return { getValues: () => this.rows.map((r) => [...r]) }; }
  appendRow(r) { this.rows.push([...r]); }
  getRange(r, c) {
    const self = this;
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

beforeEach(() => {
  const sheets = {};
  sandbox = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = new MockSheet()),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      createTextOutput: (t) => ({ _t: t, setMimeType() { return this; } }),
      MimeType: { JSON: 1 },
    },
    Math, Date, JSON, Array, String, Number,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), sandbox);
});

function post(payload) {
  const doPost = vm.runInContext('doPost', sandbox);
  return JSON.parse(doPost({ postData: { contents: JSON.stringify(payload) } })._t);
}

test('issue_code: 8桁の合言葉を発行する', () => {
  const res = post({ action: 'issue_code' });
  assert.equal(res.success, true);
  assert.match(res.code, /^[A-Z0-9]{8}$/);
});

test('issue_code: 紛らわしい文字(0,O,1,I)を含まない', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    seen.add(post({ action: 'issue_code' }).code);
  }
  const all = [...seen].join('');
  assert.equal(/[0O1I]/.test(all), false);
});

test('get_bookmarks: 発行直後は空配列を返す', () => {
  const { code } = post({ action: 'issue_code' });
  const res = post({ action: 'get_bookmarks', code });
  assert.equal(res.success, true);
  assert.deepEqual(res.bookmarks, []);
});

test('save_bookmarks → get_bookmarksで保存した内容がそのまま読める', () => {
  const { code } = post({ action: 'issue_code' });
  const bookmarks = [{ url: 'https://nexua.tech/#zz1', name: '山田', tags: ['DIY'], memo: '展示会で交換' }];
  const saveRes = post({ action: 'save_bookmarks', code, bookmarks });
  assert.equal(saveRes.success, true);
  const getRes = post({ action: 'get_bookmarks', code });
  assert.deepEqual(getRes.bookmarks, bookmarks);
});

test('save_bookmarksは前回の内容を上書きする（追記ではない）', () => {
  const { code } = post({ action: 'issue_code' });
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'a', name: '1件目' }] });
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'b', name: '2件目' }] });
  const res = post({ action: 'get_bookmarks', code });
  assert.equal(res.bookmarks.length, 1);
  assert.equal(res.bookmarks[0].name, '2件目');
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

test('未知のactionはUNKNOWN_ACTIONエラー', () => {
  const res = post({ action: 'nonexistent' });
  assert.equal(res.success, false);
  assert.equal(res.code, 'UNKNOWN_ACTION');
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark && node --test gas-backend/backend.test.js`
Expected: FAIL（`gas-backend/Code.gs`が存在しないためENOENT）

- [ ] **Step 4: Code.gsを実装する**

`gas-backend/Code.gs` を新規作成:

```js
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
  return handle(e && e.parameter ? e.parameter : {});
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
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark && node --test gas-backend/backend.test.js`
Expected: PASS（8件全て）

- [ ] **Step 6: package.jsonのtestスクリプトにgas-backendを含める**

`package.json`の`scripts.test`を次のように変更:

```json
"test": "node --test src/ gas-backend/"
```

- [ ] **Step 7: 全体テストを実行して両方通ることを確認する**

Run: `cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark && npm test`
Expected: PASS（既存43件 + 新規8件）

- [ ] **Step 8: コミット**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
git add gas-backend/ package.json
git commit -m "$(cat <<'EOF'
feat: 合言葉方式の同期バックエンド(GAS)を追加

get_bookmarks/save_bookmarks/issue_codeの3ルートを持つGAS Web App。
名刺のテキストデータを合言葉ごとに1セルのJSONとして保存する
（仕様: docs/superpowers/specs/2026-08-22-meishi-bookmark-pin-auth-design.md）。
決済は次のタスクで追加するため、issue_codeは今は誰でも呼べる。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: GAS backendをclaspでデプロイする

**Files:**
- なし（clasp操作のみ）
- Modify: `docs/superpowers/specs/2026-08-22-meishi-bookmark-pin-auth-design.md`（デプロイURLを追記）

**Interfaces:**
- Consumes: Task 1で作成した `gas-backend/Code.gs`, `gas-backend/appsscript.json`
- Produces: Web AppのデプロイURL（形式: `https://script.google.com/macros/s/{デプロイID}/exec`）— Task 4でクライアント側の定数として使う

- [ ] **Step 1: claspでGASプロジェクトを新規作成する**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark/gas-backend
clasp create-script --type standalone --title "meishi-bookmark-pocket-backend" --rootDir .
```

実行後、`gas-backend/.clasp.json`が生成される。`clasp create-script`はappsscript.jsonをデフォルト内容で上書きすることがあるため、Step 2で内容を確認する。

- [ ] **Step 2: appsscript.jsonの内容が正しいか確認し、必要なら書き戻す**

`gas-backend/appsscript.json`を読み、`webapp.executeAs`が`"USER_DEPLOYING"`、`webapp.access`が`"ANYONE"`になっていることを確認する。上書きされていた場合はTask 1 Step 1の内容で書き戻す。

- [ ] **Step 3: pushする**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark/gas-backend
clasp push --force
```

Expected: `Pushed 2 files` （Code.gs, appsscript.json）

- [ ] **Step 4: Web Appとしてデプロイする**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark/gas-backend
clasp create-deployment --description "pocket backend v1"
```

出力される `AKfycb...` で始まるデプロイIDを控える。

- [ ] **Step 5: デプロイURLへ疎通確認する**

```bash
DEPLOY_ID="<Step4で控えたデプロイID>"
curl -s "https://script.google.com/macros/s/${DEPLOY_ID}/exec?action=issue_code" | head -c 300
```

Expected: `{"success":true,"code":"..."}`という8桁の合言葉を含むJSONが返る（GETでもissue_codeが呼べることを確認。POSTでの疎通は次タスクで確認する）

- [ ] **Step 6: デプロイURLを仕様書に追記する**

`docs/superpowers/specs/2026-08-22-meishi-bookmark-pin-auth-design.md`の「未決定・実装計画フェーズで詰める事項」の下に新しいセクションを追加:

```markdown
## デプロイ済み情報

- GAS Web App URL: `https://script.google.com/macros/s/<Step4のデプロイID>/exec`
- スプレッドシート: GASプロジェクトの「概要」からリンクされる、自動作成された運営管理用スプレッドシート
```

- [ ] **Step 7: コミット**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
git add gas-backend/.clasp.json docs/superpowers/specs/2026-08-22-meishi-bookmark-pin-auth-design.md
git commit -m "$(cat <<'EOF'
docs: 合言葉バックエンドのデプロイURLを記録

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: クライアント側API呼び出しモジュール(src/pocketApi.js)

**Files:**
- Create: `src/pocketApi.js`
- Create: `src/pocketApi.test.js`

**Interfaces:**
- Consumes: Task 2で得たGAS Web AppのデプロイURL
- Produces（index.htmlが後続タスクでimportする）:
  - `issueCode(): Promise<{success: boolean, code？: string, error?: string}>`
  - `getBookmarks(code: string): Promise<{success: boolean, bookmarks?: array, error?: string}>`
  - `saveBookmarks(code: string, bookmarks: array): Promise<{success: boolean, error?: string}>`

- [ ] **Step 1: 失敗するテストを書く**

`src/pocketApi.test.js` を新規作成:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { issueCode, getBookmarks, saveBookmarks } from './pocketApi.js';

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    if (body.action === 'issue_code') return { json: async () => ({ success: true, code: 'ABCDEFGH' }) };
    if (body.action === 'get_bookmarks') return { json: async () => ({ success: true, bookmarks: [] }) };
    if (body.action === 'save_bookmarks') return { json: async () => ({ success: true }) };
    return { json: async () => ({ success: false, error: 'unknown' }) };
  };
});

test('issueCode: action=issue_codeをPOSTし、結果をそのまま返す', async () => {
  const res = await issueCode();
  assert.equal(res.success, true);
  assert.equal(res.code, 'ABCDEFGH');
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.action, 'issue_code');
});

test('issueCode: Content-Typeはtext/plain（CORSプリフライト回避のため）', async () => {
  await issueCode();
  assert.equal(calls[0].options.headers['Content-Type'], 'text/plain');
});

test('getBookmarks: codeを渡してaction=get_bookmarksをPOSTする', async () => {
  const res = await getBookmarks('ABCDEFGH');
  assert.equal(res.success, true);
  assert.deepEqual(res.bookmarks, []);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.action, 'get_bookmarks');
  assert.equal(body.code, 'ABCDEFGH');
});

test('saveBookmarks: codeとbookmarksをPOSTする', async () => {
  const bookmarks = [{ url: 'https://nexua.tech/#zz1', name: '山田' }];
  const res = await saveBookmarks('ABCDEFGH', bookmarks);
  assert.equal(res.success, true);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.action, 'save_bookmarks');
  assert.equal(body.code, 'ABCDEFGH');
  assert.deepEqual(body.bookmarks, bookmarks);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark && node --test src/pocketApi.test.js`
Expected: FAIL（`src/pocketApi.js`が存在しない）

- [ ] **Step 3: pocketApi.jsを実装する**

`src/pocketApi.js` を新規作成（`API_URL`はTask 2 Step 4のデプロイIDに差し替える）:

```js
// 合言葉方式の同期バックエンド(GAS Web App)への薄いAPIクライアント。
// Content-Type: text/plain でPOSTするのは、application/jsonだとブラウザが
// CORSプリフライト(OPTIONS)を送り、GAS Web Appはそれに正しく応答できず
// ブロックされてしまうため（GAS側はpostData.contentsから直接JSON.parseするので
// text/plainでも支障ない）
const API_URL = 'https://script.google.com/macros/s/AKfycb.../exec'; // Task 2のデプロイURLに差し替える

async function callApi(payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export function issueCode() {
  return callApi({ action: 'issue_code' });
}

export function getBookmarks(code) {
  return callApi({ action: 'get_bookmarks', code });
}

export function saveBookmarks(code, bookmarks) {
  return callApi({ action: 'save_bookmarks', code, bookmarks });
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark && node --test src/pocketApi.test.js`
Expected: PASS（4件全て）

- [ ] **Step 5: 実際のデプロイ済みGAS Web Appに対して疎通確認する（ブラウザで）**

claude-in-chromeでタブを開き、以下を実行して実際にCORSエラーなく通信できるか確認する:

```js
const res = await fetch('<Task2のデプロイURL>', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify({ action: 'issue_code' }),
});
JSON.stringify(await res.json())
```

Expected: `{"success":true,"code":"..."}` が返る。CORSエラーが出る場合は、GAS Web Appの公開設定（Task 2で`access: 'ANYONE'`にしたか）を確認する。

- [ ] **Step 6: コミット**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
git add src/pocketApi.js src/pocketApi.test.js
git commit -m "$(cat <<'EOF'
feat: 合言葉バックエンドAPIの薄いクライアント(pocketApi.js)を追加

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: index.html — 合言葉の発行・入力UIとGoogle連携コードの置き換え

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `src/pocketApi.js`の`issueCode()`, `getBookmarks(code)`, `saveBookmarks(code, bookmarks)`
- Produces: `syncMode`の値は`'local'`（今まで通り）または`'pocket'`（合言葉で同期中）の2値になる（旧`'google'`は廃止）

このタスクはUI変更のみでテストコードは書かない（既存のsrc配下のロジックへの変更がないため）。手動でのブラウザ確認をStepに含める。

- [ ] **Step 1: importにpocketApi.jsを追加し、不要になったauth関連importを整理する**

`index.html`の`<script type="module">`内、importブロックを次のように変更（バージョンクエリは全体をこの日の日付`v=20260822p`に統一する）:

```js
import { parseBookmarkParams } from './src/logic.js?v=20260822p';
import { issueCode, getBookmarks, saveBookmarks } from './src/pocketApi.js?v=20260822p';
import { filterAndSort } from './src/render.js?v=20260822p';
import { saveLocal, listLocal, deleteLocal, deleteLocalByUrl, updateLocalMemo, updateLocalTags } from './src/storage.js?v=20260822p';
```

`initGoogleAuth`, `requestLogin`（`src/auth.js`）と`findSheet, createSheet, appendBookmark, listBookmarks, updateMemo, updateTags, updatePhotoUrl, deleteBookmark`（`src/sheets.js`）のimportは削除する（これらは今回不要。写真機能用の`src/drive.js`のimportは変更しない）。

- [ ] **Step 2: `GOOGLE_CLIENT_ID`, `GOOGLE_LINKED_KEY`, トークンキャッシュ関連の定数・関数を削除する**

以下を削除する:
- `GOOGLE_CLIENT_ID`定数
- `GOOGLE_LINKED_KEY`定数
- `TOKEN_CACHE_KEY`, `TOKEN_EXPIRY_MARGIN_MS`定数
- `saveTokenCache`, `loadCachedToken`, `clearTokenCache`関数
- `isGoogleLinked`関数

代わりに次を追加する:

```js
const POCKET_CODE_KEY = 'meishi_pocket_code';

function getSavedPocketCode() {
  return localStorage.getItem(POCKET_CODE_KEY);
}
```

- [ ] **Step 3: `resetBackupBtn`を合言葉用に書き換える**

既存の`resetBackupBtn`関数を削除し、代わりに次を追加する:

```js
function showLocalOnlyUi() {
  backupBtn.disabled = false;
  backupBtn.textContent = '合言葉を発行して他の端末とも同期する';
}
```

- [ ] **Step 4: index.htmlのbackup-btn周辺HTML（同期モーダル）を合言葉用に作り直す**

`<div id="google-sync-modal">`（Googleと同期しますモーダル）を、次の3つのUI要素に置き換える:

1. 一覧画面の`backup-btn`ボタン: 押すと下記の選択モーダルを開く
2. 新しいモーダル`pocket-choice-modal`: 「新しく合言葉を発行する」「持っている合言葉を入力する」の2択
3. 合言葉表示モーダル`pocket-code-shown-modal`: 発行された8桁を表示し、「ひかえました」ボタンで閉じる
4. 合言葉入力モーダル`pocket-code-input-modal`: テキスト入力＋「同期する」ボタン

具体的なHTML（既存の`google-sync-modal`のブロックをまるごと置き換える）:

```html
<div id="pocket-choice-modal" style="display:none" class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40">
  <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-sm text-neutral-700 leading-relaxed">
    <h3 class="font-bold text-base mb-3">🔑 他の端末と同期します</h3>
    <p class="mb-4">はじめての方は合言葉を発行、すでに持っている方はその合言葉を入力してください。</p>
    <div class="flex flex-col gap-3">
      <button id="pocket-issue-btn" class="py-2.5 rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 text-white font-bold text-sm shadow-md hover:from-rose-500 hover:to-orange-500">新しく合言葉を発行する</button>
      <button id="pocket-open-input-btn" class="py-2.5 rounded-xl border border-neutral-200 text-neutral-600 font-semibold text-sm hover:border-rose-400 hover:text-rose-500">持っている合言葉を入力する</button>
      <button id="pocket-choice-cancel" class="py-2 text-neutral-400 text-xs">やめる</button>
    </div>
  </div>
</div>
<div id="pocket-code-shown-modal" style="display:none" class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40">
  <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-sm text-neutral-700 leading-relaxed text-center">
    <h3 class="font-bold text-base mb-3">🔑 合言葉が発行されました</h3>
    <p id="pocket-code-display" class="text-2xl font-mono font-bold tracking-widest my-4 text-rose-500"></p>
    <p class="text-xs text-neutral-500 mb-4">この合言葉を控えておいてください。他の端末で入力すると、同じ名刺一覧が見られます。忘れると復元できません。</p>
    <button id="pocket-code-shown-ok" class="w-full py-2.5 rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 text-white font-bold text-sm shadow-md">ひかえました</button>
  </div>
</div>
<div id="pocket-code-input-modal" style="display:none" class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40">
  <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-sm text-neutral-700 leading-relaxed">
    <h3 class="font-bold text-base mb-3">🔑 合言葉を入力してください</h3>
    <input id="pocket-code-input" type="text" maxlength="8" placeholder="例: A7K9QZ2M" class="w-full mb-4 px-4 py-2.5 bg-white/80 border border-neutral-200 rounded-xl text-sm text-center font-mono tracking-widest uppercase focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all" />
    <div class="flex gap-3">
      <button id="pocket-code-input-cancel" class="flex-1 py-2.5 rounded-xl border border-neutral-200 text-neutral-500 font-semibold text-sm hover:bg-neutral-50">やめる</button>
      <button id="pocket-code-input-ok" class="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 text-white font-bold text-sm shadow-md hover:from-rose-500 hover:to-orange-500">同期する</button>
    </div>
  </div>
</div>
```

- [ ] **Step 5: DOM参照とイベントハンドラを追加する**

要素参照ブロック（`const backupBtn = ...`の近く）に追加:

```js
const pocketChoiceModal = document.getElementById('pocket-choice-modal');
const pocketIssueBtn = document.getElementById('pocket-issue-btn');
const pocketOpenInputBtn = document.getElementById('pocket-open-input-btn');
const pocketChoiceCancel = document.getElementById('pocket-choice-cancel');
const pocketCodeShownModal = document.getElementById('pocket-code-shown-modal');
const pocketCodeDisplay = document.getElementById('pocket-code-display');
const pocketCodeShownOk = document.getElementById('pocket-code-shown-ok');
const pocketCodeInputModal = document.getElementById('pocket-code-input-modal');
const pocketCodeInput = document.getElementById('pocket-code-input');
const pocketCodeInputCancel = document.getElementById('pocket-code-input-cancel');
const pocketCodeInputOk = document.getElementById('pocket-code-input-ok');
```

`backupBtn`のクリックハンドラ（既存の`syncModalEl`を開く処理）を次に置き換える:

```js
backupBtn.addEventListener('click', () => {
  pocketChoiceModal.style.display = 'flex';
});
pocketChoiceCancel.addEventListener('click', () => {
  pocketChoiceModal.style.display = 'none';
});
pocketIssueBtn.addEventListener('click', async () => {
  pocketChoiceModal.style.display = 'none';
  backupBtn.disabled = true;
  backupBtn.textContent = '発行しています...';
  try {
    const res = await issueCode();
    if (!res.success) throw new Error(res.error || '発行に失敗しました');
    localStorage.setItem(POCKET_CODE_KEY, res.code);
    pocketCodeDisplay.textContent = res.code;
    pocketCodeShownModal.style.display = 'flex';
  } catch (err) {
    await appAlert('合言葉の発行に失敗しました。もう一度お試しください。');
    showLocalOnlyUi();
  }
});
pocketCodeShownOk.addEventListener('click', async () => {
  pocketCodeShownModal.style.display = 'none';
  await syncWithPocketCode(getSavedPocketCode());
});
pocketOpenInputBtn.addEventListener('click', () => {
  pocketChoiceModal.style.display = 'none';
  pocketCodeInput.value = '';
  pocketCodeInputModal.style.display = 'flex';
});
pocketCodeInputCancel.addEventListener('click', () => {
  pocketCodeInputModal.style.display = 'none';
});
pocketCodeInputOk.addEventListener('click', async () => {
  const code = pocketCodeInput.value.trim().toUpperCase();
  if (!code) return;
  pocketCodeInputModal.style.display = 'none';
  localStorage.setItem(POCKET_CODE_KEY, code);
  backupBtn.disabled = true;
  backupBtn.textContent = '同期しています...';
  await syncWithPocketCode(code);
});
```

- [ ] **Step 6: `backupFlow`を`syncWithPocketCode`に作り直す**

既存の`backupFlow`関数（Google Sheetsとの差分同期ロジック）を全て削除し、次に置き換える:

```js
// 合言葉で同期する。ローカルの新規分をアップロードしてから、最新の一覧を取得する
async function syncWithPocketCode(code) {
  try {
    const remote = await getBookmarks(code);
    if (!remote.success) throw new Error(remote.error || '合言葉が見つかりません');
    const remoteList = remote.bookmarks;
    const localList = listLocal();
    const merged = [...remoteList];
    for (const localB of localList) {
      if (!remoteList.some((r) => r.url === localB.url)) {
        merged.push(localB);
      }
    }
    const saveRes = await saveBookmarks(code, merged);
    if (!saveRes.success) throw new Error(saveRes.error || '保存に失敗しました');

    allBookmarks = merged;
    syncMode = 'pocket';
    backupBtn.textContent = '同期済みです';
    pageTitleEl.textContent = '合言葉で同期中 - NEXUA名刺ポケット';
    document.body.classList.add('google-synced');
    renderCards();
  } catch (err) {
    await appAlert('同期に失敗しました。もう一度お試しください。');
    showLocalOnlyUi();
  }
}
```

- [ ] **Step 7: `listFlow`を合言葉方式に書き換える**

既存の`listFlow`関数内、Google連携判定・トークンキャッシュ・サイレントログイン関連の分岐を全て削除し、次のシンプルな形に置き換える:

```js
function listFlow() {
  allBookmarks = listLocal();
  syncMode = 'local';
  statusEl.style.display = 'none';
  listUi.style.display = 'block';
  renderCards();

  const savedCode = getSavedPocketCode();
  if (savedCode) {
    pageTitleEl.textContent = '合言葉で同期中 - NEXUA名刺ポケット';
    document.body.classList.add('google-synced');
    backupBtn.disabled = true;
    backupBtn.textContent = '同期しています...';
    syncWithPocketCode(savedCode);
  } else {
    showLocalOnlyUi();
  }
}
```

- [ ] **Step 8: 削除ボタンのGoogle Sheets呼び出しを合言葉方式に置き換える**

一覧カードの削除ボタンのクリックハンドラ内、`syncMode === 'google'`を`syncMode === 'pocket'`に変更し、`deleteBookmark(...)`のAPI呼び出しを次に置き換える:

```js
if (syncMode === 'pocket') {
  const code = getSavedPocketCode();
  const updated = allBookmarks.filter((x) => x !== b);
  const res = await saveBookmarks(code, updated);
  if (!res.success) throw new Error(res.error || '削除に失敗しました');
  allBookmarks = updated;
  deleteLocalByUrl(b.url);
} else {
  deleteLocal(b.id);
  allBookmarks = allBookmarks.filter((x) => x.id !== b.id);
}
```

- [ ] **Step 9: メモ編集・タグ編集の保存処理も合言葉方式に置き換える**

メモ編集の保存処理内、`syncMode === 'google'`を`syncMode === 'pocket'`に変更し、`updateMemo(...)`のAPI呼び出しを次に置き換える（タグ編集も同様のパターンで`updateTags`相当部分を書き換える）:

```js
if (syncMode === 'pocket') {
  const code = getSavedPocketCode();
  const updated = allBookmarks.map((x) => (x === b ? { ...x, memo: newMemo } : x));
  const res = await saveBookmarks(code, updated);
  if (!res.success) throw new Error(res.error || 'メモの保存に失敗しました');
  allBookmarks = updated;
} else {
  updateLocalMemo(b.id, newMemo);
  allBookmarks = allBookmarks.map((x) => (x.id === b.id ? { ...x, memo: newMemo } : x));
}
```

- [ ] **Step 10: 構文チェックを行う**

Run:
```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
grep -n '<script type="module"' index.html
grep -n '</script>' index.html
```
表示された開始行+1から終了行-1の範囲を`sed`で抜き出し、`node --check`で構文確認する（過去のコミットと同じ手順、末尾に`</script>`の行番号-1を終端に使う）。
Expected: 構文エラーなし

- [ ] **Step 11: 全ユニットテストを実行する**

Run: `cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark && npm test`
Expected: PASS（全件、index.htmlはユニットテスト対象外なので件数は変わらない）

- [ ] **Step 12: ブラウザで一連の動作を手動確認する**

claude-in-chromeで以下を確認する:
1. 名刺保存フロー（`?url=...&name=...`付きでアクセス）→ ローカル保存の表示が変わっていないこと
2. 一覧画面を開き、「合言葉を発行して他の端末とも同期する」ボタン→選択モーダル→「新しく合言葉を発行する」→8桁の合言葉が表示されること
3. 「ひかえました」→ タイトルが「合言葉で同期中 - NEXUA名刺ポケット」になり、背景が青系になること
4. localStorageの`meishi_pocket_code`に発行された合言葉が保存されていること（javascript_toolで確認）
5. ページをリロードし、自動的に同じ合言葉で再同期されること（Googleのような勝手なアカウント選択画面が一切出ないこと）
6. 別のブラウザタブ（または同一タブでlocalStorageをクリアしてから）その合言葉を「持っている合言葉を入力する」で入れ、同じデータが見えること

- [ ] **Step 13: コミット**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
git add index.html
git commit -m "$(cat <<'EOF'
feat: index.htmlの同期UIをGoogle連携から合言葉方式へ全面置き換え

「Googleでバックアップ」ボタンを「合言葉を発行して他の端末とも
同期する」に置き換え、Google Identity Services経由の同期コード
（トークンキャッシュ・サイレントログイン等）を全て削除した。
紙の名刺・写真機能用のGoogle連携（src/auth.js, src/drive.js）は
変更していない。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 不要になったGoogle連携コード(src/sheets.js)の整理

**Files:**
- Modify: `src/sheets.js`
- Modify: `src/sheets.test.js`

**Interfaces:**
- Consumes: なし
- Produces: なし（このタスクは削除のみ）

紙の名刺・写真機能（段階3）は今回変更しないため、`src/sheets.js`のうち同期・バックアップ専用だった関数（`findSheet`, `createSheet`, `listBookmarks`, `appendBookmark`, `updateMemo`, `updateTags`, `deleteBookmark`）は、Task 4の変更で呼び出し元がなくなった。ただし、紙の名刺登録機能（`paperCardSaveBtn`のハンドラ）が`appendBookmark`相当の処理をGoogle Sheetsに対して行っているかどうかは、削除前に必ず確認すること。

- [ ] **Step 1: index.html内でsrc/sheets.jsの各関数がまだ使われていないか確認する**

Run:
```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
grep -n "findSheet\|createSheet\|listBookmarks\|appendBookmark\|updateMemo\|updateTags\|updatePhotoUrl\|deleteBookmark" index.html
```

紙の名刺登録処理（`paperCardSaveBtn`まわり）で`appendBookmark`等が使われている場合、このタスクはスキップし、計画全体をここで一度中断してユーザーに相談する（段階3の設計が固まるまで`src/sheets.js`は残す）。使われていなければStep 2へ進む。

- [ ] **Step 2: 使われていない場合のみ、sheets.jsとそのテストを削除する**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
rm src/sheets.js src/sheets.test.js
```

- [ ] **Step 3: 全体テストを実行する**

Run: `cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark && npm test`
Expected: PASS（sheets.test.jsの分だけ件数が減る）

- [ ] **Step 4: コミット**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
git add -A
git commit -m "$(cat <<'EOF'
refactor: 同期専用だったsrc/sheets.jsを削除（合言葉方式に置き換え済み）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 本番デプロイと実機確認

**Files:** なし（デプロイ・確認のみ）

- [ ] **Step 1: GitHub Pagesへpushする**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
git push origin main
```

push直後の出力に偽装/異常な警告が出た場合は信用せず、`gh api repos/laxuz999/meishi-bookmark/commits/main --jq '.sha'`で独立に反映を確認する。

- [ ] **Step 2: デプロイ完了を待つ**

```bash
gh run list --repo laxuz999/meishi-bookmark --limit 1 --json status,conclusion,headSha
```
`status`が`completed`かつ`conclusion`が`success`になるまで、間隔をあけて確認する。

- [ ] **Step 3: 本番URLで一連の動作を再確認する**

Task 4 Step 12と同じ手順を、`https://laxuz999.github.io/meishi-bookmark/?_cachebust=<任意の数字>`で実施する。

- [ ] **Step 4: ユーザーに完了報告する**

以下を報告する: デプロイ済みのコミットSHA、確認できた動作（合言葉の発行・入力・同期・削除）、次の段階（決済）が未実装であること（今の合言葉発行は無料で誰でも呼べる状態のままであること）。
