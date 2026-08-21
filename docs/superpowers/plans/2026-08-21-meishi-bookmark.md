# 名刺ブックマークアプリ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NEXUAで名刺を見せられた人（NEXUAユーザーでなくてもよい）が、受け取った名刺URLをワンタップで自分のGoogle Driveに保存し、後から一覧で見返せるようにする独立Webアプリを作る。

**Architecture:** 完全に静的なフロントエンド（HTML+JS、サーバーなし）。Google Identity Servicesでログインし、取得したアクセストークンでブラウザから直接Google Sheets API / Drive APIを呼ぶ。運営(NEXUA)側のインフラは一切増やさない。NEXUA本体には「保存」ボタンを1つ追加するだけ。

**Tech Stack:** Vanilla JS（フレームワークなし）、Tailwind CDN、Google Identity Services、Google Sheets API v4、Google Drive API v3、Node.js標準test runner（ロジックのユニットテスト用）、GitHub Pages。

**Spec:** `/Users/blackcoffee/WEB/XYZ/meishi-bookmark/docs/superpowers/specs/2026-08-21-meishi-bookmark-design.md`

## Global Constraints

- 対象ユーザーはNEXUAアカウントを持たない一般の人も含む（Googleアカウントさえあれば使える）
- 運営(NEXUA)側のサーバー・データベースを新設しない。データはお客様自身のGoogle Driveにのみ保存
- 保存データ項目: 名刺URL・表示名・タグ（配列）・保存日時
- 重複保存の防止は行わない（初期バージョンでは対象外）
- デザイントーンはNEXUA(`welcome.html`/`help.html`)と統一（オレンジ・ローズ系グラデーション、Tailwind CDN）
- 公開先: 新規GitHubリポジトリ + GitHub Pages

---

## File Structure

```
meishi-bookmark/
  index.html              # 唯一のHTMLページ。URLパラメータの有無で「保存モード」「一覧モード」を切替
  src/
    logic.js               # 純粋関数（URL解析・データ整形）。DOM/API非依存でテスト可能
    logic.test.js           # logic.jsのユニットテスト
    sheets.js               # Google Sheets/Drive API呼び出し関数群
    sheets.test.js           # sheets.jsのユニットテスト（fetchをモック）
  package.json              # "type": "module"、テスト実行用（依存パッケージなし）
  README.md                 # プロジェクト概要・OAuthクライアントID設置手順
  .github/workflows/deploy.yml  # pushで自動デプロイ（GitHub Pages）
  docs/
    superpowers/
      specs/2026-08-21-meishi-bookmark-design.md   # 既存（このplanの元spec）
      plans/2026-08-21-meishi-bookmark.md            # このファイル
```

`src/logic.js` と `src/sheets.js` を分けるのは責務分離のため：`logic.js`はGoogle APIを一切知らない純粋関数（テストが速く確実）、`sheets.js`はGoogle API呼び出しの実処理（モックでテスト）。

---

### Task 0: リポジトリ雛形とGitHub Pages公開

**Files:**
- Create: `/Users/blackcoffee/WEB/XYZ/meishi-bookmark/index.html`
- Create: `/Users/blackcoffee/WEB/XYZ/meishi-bookmark/README.md`
- Create: `/Users/blackcoffee/WEB/XYZ/meishi-bookmark/.gitignore`
- Create: `/Users/blackcoffee/WEB/XYZ/meishi-bookmark/.github/workflows/deploy.yml`

**Interfaces:**
- Produces: 公開URL（後続タスクがこのURLに向けてOAuthクライアントIDの承認済みオリジンを設定する）

- [ ] **Step 1: 最小限のindex.htmlを作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>名刺ブックマーク</title>
</head>
<body>
  <p>準備中です。</p>
</body>
</html>
```

- [ ] **Step 2: README.mdを作成**

```markdown
# 名刺ブックマーク

NEXUAの名刺URLを、自分のGoogle Driveに保存して一覧で見返せるツール。

- 本番サイト: (デプロイ後に記入)
- データはお客様自身のGoogle Drive内「NEXUAブックマーク」シートに保存され、運営側は一切保持しません

## 開発

静的サイトなのでビルド不要。`index.html`を直接開くか、`npx serve`等でローカル確認。

## テスト

\`\`\`
node --test src/
\`\`\`

## OAuthクライアントIDの設定

1. Google Cloud Consoleで新規プロジェクトを作成
2. 「APIとサービス」→「認証情報」→「OAuthクライアントIDを作成」（種類: ウェブアプリケーション）
3. 「承認済みのJavaScript生成元」に本番URLを追加
4. 「APIとサービス」→「ライブラリ」で Google Sheets API と Google Drive API を有効化
5. 発行されたクライアントIDを `index.html` 内の `GOOGLE_CLIENT_ID` に設定
```

- [ ] **Step 3: .gitignoreを作成**

```
.DS_Store
node_modules/
```

- [ ] **Step 4: GitHub Pages自動デプロイのワークフローを作成**

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 5: git初期化してコミット**

```bash
cd /Users/blackcoffee/WEB/XYZ/meishi-bookmark
git init
git add .
git commit -m "chore: プロジェクト雛形"
```

- [ ] **Step 6: GitHubリポジトリを新規作成してpush（ユーザー確認必須— 外部への新規公開のため）**

```bash
gh repo create meishi-bookmark --public --source=. --remote=origin --push
```

- [ ] **Step 7: GitHub PagesをGitHub Actions経由で有効化**

リポジトリの Settings → Pages → Source を「GitHub Actions」に設定（`gh api`でも可能、UIでの確認を推奨）。

- [ ] **Step 8: デプロイ完了を確認**

```bash
gh run list --limit 1
```
Expected: `Deploy to GitHub Pages` が `success`

公開URL（`https://<username>.github.io/meishi-bookmark/`）にアクセスし、「準備中です。」が表示されることを確認する。

---

### Task 1: 保存データ組み立てロジック（純粋関数・TDD）

**Files:**
- Create: `src/logic.js`
- Test: `src/logic.test.js`

**Interfaces:**
- Produces: `parseBookmarkParams(searchParams: URLSearchParams): {url: string, name: string, tags: string[]} | null`
  - NEXUA側は `?url=<encoded>&name=<encoded>&tags=<comma-separated,encoded>` の形式でリンクする
  - `url`が無ければ`null`を返す（＝一覧モードとして扱う合図）

- [ ] **Step 1: package.jsonを作成（テスト実行の土台）**

```json
{
  "name": "meishi-bookmark",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test src/"
  }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`src/logic.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBookmarkParams } from './logic.js';

test('url/name/tagsが揃っている場合、パースできる', () => {
  const params = new URLSearchParams('url=https%3A%2F%2Fnexua.tech%2F%23zz123&name=%E5%B1%B1%E7%94%B0%E5%A4%AA%E9%83%8E&tags=DIY%2C%E9%87%A3%E3%82%8A');
  const result = parseBookmarkParams(params);
  assert.deepEqual(result, {
    url: 'https://nexua.tech/#zz123',
    name: '山田太郎',
    tags: ['DIY', '釣り']
  });
});

test('urlが無ければnullを返す（一覧モード）', () => {
  const params = new URLSearchParams('');
  assert.equal(parseBookmarkParams(params), null);
});

test('nameが無ければ空文字にフォールバックする', () => {
  const params = new URLSearchParams('url=https%3A%2F%2Fnexua.tech%2F%23zz123');
  const result = parseBookmarkParams(params);
  assert.equal(result.name, '');
  assert.deepEqual(result.tags, []);
});

test('tagsが空文字の要素を含む場合は取り除く', () => {
  const params = new URLSearchParams('url=https%3A%2F%2Fnexua.tech%2F%23zz123&tags=DIY%2C%2C%E9%87%A3%E3%82%8A');
  const result = parseBookmarkParams(params);
  assert.deepEqual(result.tags, ['DIY', '釣り']);
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `node --test src/`
Expected: FAIL（`src/logic.js`が存在しない、または`parseBookmarkParams`が未定義というエラー）

- [ ] **Step 4: 最小実装を書く**

`src/logic.js`:
```js
export function parseBookmarkParams(searchParams) {
  const url = searchParams.get('url');
  if (!url) return null;
  const name = searchParams.get('name') || '';
  const tagsRaw = searchParams.get('tags') || '';
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  return { url, name, tags };
}
```

- [ ] **Step 5: テストを実行して通過を確認**

Run: `node --test src/`
Expected: PASS（4 tests）

- [ ] **Step 6: コミット**

```bash
git add package.json src/logic.js src/logic.test.js
git commit -m "feat: URLパラメータから保存データを組み立てるロジック"
```

---

### Task 2: Google認証（Identity Services統合）

**Files:**
- Modify: `index.html`
- Create: `src/auth.js`

**Interfaces:**
- Consumes: なし
- Produces: `initGoogleAuth(clientId: string, onToken: (accessToken: string) => void): void`、`requestLogin(): void`
  - `onToken`はログイン成功のたびに呼ばれる（トークンは`sheets.js`の各関数にそのまま渡す）

**この Task には外部サービスでの手作業が必要です。実装者はコードを書き終えたら、ユーザーに以下を依頼してください（勝手に進めない）:**

1. Google Cloud Console (https://console.cloud.google.com/) で新規プロジェクトを作成
2. 「APIとサービス」→「ライブラリ」で **Google Sheets API** と **Google Drive API** を有効化
3. 「APIとサービス」→「OAuth同意画面」を設定（User Type: 外部、公開ステータスはテスト中でも可）
4. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuthクライアントID」（種類: ウェブアプリケーション）
5. 「承認済みのJavaScript生成元」に Task 0 で確認した公開URL（`https://<username>.github.io`）を追加
6. 発行されたクライアントID（`xxxxx.apps.googleusercontent.com`の形式）を教えてもらう

- [ ] **Step 1: src/auth.jsを作成**

```js
let tokenClient = null;

export function initGoogleAuth(clientId, onToken) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
    callback: (response) => {
      if (response.access_token) onToken(response.access_token);
    },
  });
}

export function requestLogin() {
  if (!tokenClient) throw new Error('initGoogleAuthが先に呼ばれていません');
  tokenClient.requestAccessToken();
}
```

`drive.file`スコープを使うのは、このアプリが作成/開いたファイルにしかアクセスできない制限付きスコープのため（ユーザーの他のDriveファイルには一切触れない）。

- [ ] **Step 2: index.htmlにGISスクリプトとログインボタンを追加**

`index.html`の`<head>`に追加:
```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

`<body>`に追加（Task 0の「準備中です」を置き換え）:
```html
<div id="app">
  <button id="login-btn" style="display:none">Googleでログイン</button>
  <p id="status">読み込み中...</p>
</div>
<script type="module">
  import { initGoogleAuth, requestLogin } from './src/auth.js';

  const GOOGLE_CLIENT_ID = 'REPLACE_WITH_ACTUAL_CLIENT_ID'; // Step 3で実際の値に差し替える

  window.addEventListener('load', () => {
    initGoogleAuth(GOOGLE_CLIENT_ID, (token) => {
      document.getElementById('status').textContent = 'ログインしました';
      window.__accessToken = token; // Task 3以降でこのグローバルを使う
    });
    document.getElementById('login-btn').style.display = 'inline-block';
    document.getElementById('status').textContent = 'ログインしてください';
  });
  document.getElementById('login-btn').addEventListener('click', () => requestLogin());
</script>
```

- [ ] **Step 3: ユーザーからクライアントIDを受け取り、`GOOGLE_CLIENT_ID`に設定する**

上記手作業（1〜6）の結果を待ち、教えてもらったクライアントIDで`index.html`内の`REPLACE_WITH_ACTUAL_CLIENT_ID`を置き換える。

- [ ] **Step 4: 手動で動作確認**

ローカルで`npx serve`等を実行し、ブラウザで開いて「Googleでログイン」ボタンを押す。Googleのログイン・同意画面が出て、承認後に「ログインしました」と表示されることを確認する（`REPLACE_WITH_ACTUAL_CLIENT_ID`のままだと動かないので、Step 3が先に完了している必要がある）。

- [ ] **Step 5: コミット**

```bash
git add index.html src/auth.js
git commit -m "feat: Googleログイン機能を追加"
```

---

### Task 3: Google Sheets保存処理（検索・作成・追記・一覧・削除）

**Files:**
- Create: `src/sheets.js`
- Test: `src/sheets.test.js`

**Interfaces:**
- Consumes: アクセストークン文字列（Task 2の`onToken`から得る）
- Produces:
  - `findSheet(token: string): Promise<{spreadsheetId: string, gid: number} | null>`
  - `createSheet(token: string): Promise<{spreadsheetId: string, gid: number}>`
  - `appendBookmark(token: string, spreadsheetId: string, bookmark: {url: string, name: string, tags: string[]}): Promise<void>`
  - `listBookmarks(token: string, spreadsheetId: string): Promise<Array<{rowIndex: number, url: string, name: string, tags: string[], savedAt: string}>>`
  - `deleteBookmark(token: string, spreadsheetId: string, gid: number, rowIndex: number): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く（fetchをモック化）**

`src/sheets.test.js`:
```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { findSheet, createSheet, appendBookmark, listBookmarks, deleteBookmark } from './sheets.js';

let originalFetch;
let calls;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(responseBody, status = 200) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      status,
      json: async () => responseBody,
    };
  };
}

test('findSheet: 既存シートが見つかればidとgidを返す', async () => {
  mockFetch({ files: [{ id: 'sheet123' }] });
  const result = await findSheet('tok');
  assert.equal(result.spreadsheetId, 'sheet123');
  assert.match(calls[0].url, /drive\/v3\/files/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
});

test('findSheet: 見つからなければnullを返す', async () => {
  mockFetch({ files: [] });
  const result = await findSheet('tok');
  assert.equal(result, null);
});

test('createSheet: 新規作成してヘッダー行を書き込む', async () => {
  let call = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    call++;
    if (call === 1) {
      return { status: 200, json: async () => ({ spreadsheetId: 'newid', sheets: [{ properties: { sheetId: 0 } }] }) };
    }
    return { status: 200, json: async () => ({}) };
  };
  const result = await createSheet('tok');
  assert.equal(result.spreadsheetId, 'newid');
  assert.equal(result.gid, 0);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /values\/bookmarks!A1:D1/);
});

test('appendBookmark: 行を追記するAPIを呼ぶ', async () => {
  mockFetch({});
  await appendBookmark('tok', 'sheet123', { url: 'https://nexua.tech/#zz1', name: '山田', tags: ['DIY', '釣り'] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /values\/bookmarks!A:D:append/);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.values[0][0], 'https://nexua.tech/#zz1');
  assert.equal(body.values[0][1], '山田');
  assert.equal(body.values[0][2], 'DIY,釣り');
});

test('listBookmarks: 行データをオブジェクト配列に変換する（rowIndexはヘッダー分+2から）', async () => {
  mockFetch({ values: [
    ['https://nexua.tech/#zz1', '山田', 'DIY,釣り', '2026-08-21T00:00:00.000Z'],
    ['https://nexua.tech/#zz2', '田中', '', '2026-08-22T00:00:00.000Z'],
  ]});
  const result = await listBookmarks('tok', 'sheet123');
  assert.equal(result.length, 2);
  assert.equal(result[0].rowIndex, 2);
  assert.deepEqual(result[0].tags, ['DIY', '釣り']);
  assert.equal(result[1].rowIndex, 3);
  assert.deepEqual(result[1].tags, []);
});

test('listBookmarks: データが無ければ空配列', async () => {
  mockFetch({});
  const result = await listBookmarks('tok', 'sheet123');
  assert.deepEqual(result, []);
});

test('deleteBookmark: 行削除のbatchUpdateを呼ぶ', async () => {
  mockFetch({});
  await deleteBookmark('tok', 'sheet123', 0, 3);
  assert.match(calls[0].url, /sheet123:batchUpdate/);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.requests[0].deleteDimension.range.startIndex, 2);
  assert.equal(body.requests[0].deleteDimension.range.endIndex, 3);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test src/`
Expected: FAIL（`src/sheets.js`が存在しない）

- [ ] **Step 3: 実装を書く**

`src/sheets.js`:
```js
const SHEET_NAME = 'NEXUAブックマーク';
const TAB_NAME = 'bookmarks';

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

export async function findSheet(token) {
  const q = encodeURIComponent(`name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}`, {
    headers: authHeader(token),
  });
  const data = await res.json();
  if (!data.files || data.files.length === 0) return null;
  const spreadsheetId = data.files[0].id;
  return { spreadsheetId, gid: 0 };
}

export async function createSheet(token) {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: SHEET_NAME },
      sheets: [{ properties: { title: TAB_NAME } }],
    }),
  });
  const data = await res.json();
  const spreadsheetId = data.spreadsheetId;
  const gid = data.sheets[0].properties.sheetId;

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A1:D1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [['url', 'name', 'tags', 'savedAt']] }),
  });

  return { spreadsheetId, gid };
}

export async function appendBookmark(token, spreadsheetId, bookmark) {
  const row = [bookmark.url, bookmark.name, (bookmark.tags || []).join(','), new Date().toISOString()];
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A:D:append?valueInputOption=RAW`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
}

export async function listBookmarks(token, spreadsheetId) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A2:D`, {
    headers: authHeader(token),
  });
  const data = await res.json();
  const values = data.values || [];
  return values.map((row, i) => ({
    rowIndex: i + 2,
    url: row[0] || '',
    name: row[1] || '',
    tags: (row[2] || '').split(',').map(t => t.trim()).filter(Boolean),
    savedAt: row[3] || '',
  }));
}

export async function deleteBookmark(token, spreadsheetId, gid, rowIndex) {
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId: gid, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex },
        },
      }],
    }),
  });
}
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `node --test src/`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add src/sheets.js src/sheets.test.js
git commit -m "feat: Google Sheets保存・一覧・削除ロジック"
```

---

### Task 4: 保存モードのUI（NEXUAから飛んできた時の画面）

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `parseBookmarkParams`（Task 1）、`initGoogleAuth`/`requestLogin`（Task 2）、`findSheet`/`createSheet`/`appendBookmark`（Task 3）

- [ ] **Step 1: index.htmlのスクリプト部分を、保存モード対応に拡張**

`index.html`の`<script type="module">`内を以下に置き換える（Task 2で書いたログイン部分を含む形に統合）:

```html
<script type="module">
  import { parseBookmarkParams } from './src/logic.js';
  import { initGoogleAuth, requestLogin } from './src/auth.js';
  import { findSheet, createSheet, appendBookmark } from './src/sheets.js';

  const GOOGLE_CLIENT_ID = 'REPLACE_WITH_ACTUAL_CLIENT_ID';
  const bookmark = parseBookmarkParams(new URLSearchParams(location.search));
  const statusEl = document.getElementById('status');
  const loginBtn = document.getElementById('login-btn');

  async function saveFlow(token) {
    statusEl.textContent = '保存しています...';
    let sheet = await findSheet(token);
    if (!sheet) sheet = await createSheet(token);
    await appendBookmark(token, sheet.spreadsheetId, bookmark);
    statusEl.textContent = `「${bookmark.name || bookmark.url}」を保存しました。このタブは閉じて大丈夫です。`;
    loginBtn.style.display = 'none';
  }

  window.addEventListener('load', () => {
    initGoogleAuth(GOOGLE_CLIENT_ID, (token) => {
      window.__accessToken = token;
      if (bookmark) {
        saveFlow(token);
      } else {
        statusEl.textContent = 'ログインしました';
      }
    });
    loginBtn.style.display = 'inline-block';
    statusEl.textContent = bookmark
      ? `「${bookmark.name || bookmark.url}」を保存します。ログインしてください`
      : 'ログインしてください';
  });
  loginBtn.addEventListener('click', () => requestLogin());
</script>
```

- [ ] **Step 2: 手動で動作確認**

ローカルサーバーで `index.html?url=https%3A%2F%2Fnexua.tech%2F%23zz123&name=%E3%83%86%E3%82%B9%E3%83%88&tags=DIY` を開き、ログイン→自動保存→完了メッセージが出ることを確認する。実際にGoogle Driveに「NEXUAブックマーク」というスプレッドシートが作成され、1行追記されていることを確認する。

- [ ] **Step 3: コミット**

```bash
git add index.html
git commit -m "feat: 保存モードのUIを実装"
```

---

### Task 5: 一覧モードのUI（保存済み名刺の一覧表示・検索・削除）

**Files:**
- Modify: `index.html`
- Create: `src/render.js`
- Test: `src/render.test.js`

**Interfaces:**
- Consumes: `listBookmarks`/`deleteBookmark`（Task 3）
- Produces: `filterAndSort(bookmarks: Array, query: string, sortOrder: 'newest'|'oldest'): Array` — 検索・並び替えの純粋関数（テスト可能）

- [ ] **Step 1: 失敗するテストを書く**

`src/render.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSort } from './render.js';

const sample = [
  { name: '山田太郎', url: 'https://nexua.tech/#zz1', tags: ['DIY'], savedAt: '2026-08-20T00:00:00.000Z' },
  { name: '田中花子', url: 'https://nexua.tech/#zz2', tags: ['釣り'], savedAt: '2026-08-21T00:00:00.000Z' },
];

test('queryで名前を絞り込める', () => {
  const result = filterAndSort(sample, '山田', 'newest');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, '山田太郎');
});

test('queryが空なら全件返す', () => {
  const result = filterAndSort(sample, '', 'newest');
  assert.equal(result.length, 2);
});

test('newestで新しい順に並ぶ', () => {
  const result = filterAndSort(sample, '', 'newest');
  assert.equal(result[0].name, '田中花子');
});

test('oldestで古い順に並ぶ', () => {
  const result = filterAndSort(sample, '', 'oldest');
  assert.equal(result[0].name, '山田太郎');
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test src/`
Expected: FAIL（`src/render.js`が存在しない）

- [ ] **Step 3: 実装を書く**

`src/render.js`:
```js
export function filterAndSort(bookmarks, query, sortOrder) {
  const q = (query || '').trim().toLowerCase();
  let result = q
    ? bookmarks.filter(b => b.name.toLowerCase().includes(q))
    : bookmarks.slice();
  result.sort((a, b) => {
    const diff = new Date(a.savedAt) - new Date(b.savedAt);
    return sortOrder === 'oldest' ? diff : -diff;
  });
  return result;
}
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `node --test src/`
Expected: PASS（全テスト）

- [ ] **Step 5: index.htmlに一覧UIを追加**

`<body>`の`<div id="app">`内に一覧用の要素を追加:
```html
<div id="app">
  <button id="login-btn" style="display:none">Googleでログイン</button>
  <p id="status">読み込み中...</p>
  <div id="list-ui" style="display:none">
    <input id="search" type="text" placeholder="名前で検索" />
    <select id="sort">
      <option value="newest">新しい順</option>
      <option value="oldest">古い順</option>
    </select>
    <div id="cards"></div>
  </div>
</div>
```

保存モードのスクリプトに、一覧モード（`bookmark === null`のとき）の分岐を追加。`index.html`の`<script type="module">`を以下のように拡張:
```html
<script type="module">
  import { parseBookmarkParams } from './src/logic.js';
  import { initGoogleAuth, requestLogin } from './src/auth.js';
  import { findSheet, createSheet, appendBookmark, listBookmarks, deleteBookmark } from './src/sheets.js';
  import { filterAndSort } from './src/render.js';

  const GOOGLE_CLIENT_ID = 'REPLACE_WITH_ACTUAL_CLIENT_ID';
  const bookmark = parseBookmarkParams(new URLSearchParams(location.search));
  const statusEl = document.getElementById('status');
  const loginBtn = document.getElementById('login-btn');
  const listUi = document.getElementById('list-ui');
  const cardsEl = document.getElementById('cards');
  const searchEl = document.getElementById('search');
  const sortEl = document.getElementById('sort');

  let currentSheet = null;
  let allBookmarks = [];

  async function saveFlow(token) {
    statusEl.textContent = '保存しています...';
    let sheet = await findSheet(token);
    if (!sheet) sheet = await createSheet(token);
    await appendBookmark(token, sheet.spreadsheetId, bookmark);
    statusEl.textContent = `「${bookmark.name || bookmark.url}」を保存しました。このタブは閉じて大丈夫です。`;
    loginBtn.style.display = 'none';
  }

  function renderCards() {
    const filtered = filterAndSort(allBookmarks, searchEl.value, sortEl.value);
    cardsEl.innerHTML = '';
    for (const b of filtered) {
      const card = document.createElement('div');
      card.innerHTML = `
        <a href="${b.url}" target="_blank" rel="noopener noreferrer">${b.name || b.url}</a>
        <span>${b.tags.join('・')}</span>
        <button data-row="${b.rowIndex}">削除</button>
      `;
      card.querySelector('button').addEventListener('click', async () => {
        await deleteBookmark(window.__accessToken, currentSheet.spreadsheetId, currentSheet.gid, b.rowIndex);
        allBookmarks = allBookmarks.filter(x => x.rowIndex !== b.rowIndex);
        renderCards();
      });
      cardsEl.appendChild(card);
    }
  }

  async function listFlow(token) {
    statusEl.textContent = '読み込んでいます...';
    currentSheet = await findSheet(token);
    if (!currentSheet) {
      statusEl.textContent = 'まだ保存された名刺がありません';
      return;
    }
    allBookmarks = await listBookmarks(token, currentSheet.spreadsheetId);
    statusEl.style.display = 'none';
    listUi.style.display = 'block';
    renderCards();
  }

  window.addEventListener('load', () => {
    initGoogleAuth(GOOGLE_CLIENT_ID, (token) => {
      window.__accessToken = token;
      if (bookmark) {
        saveFlow(token);
      } else {
        listFlow(token);
      }
    });
    loginBtn.style.display = 'inline-block';
    statusEl.textContent = bookmark
      ? `「${bookmark.name || bookmark.url}」を保存します。ログインしてください`
      : 'ログインしてください';
  });
  loginBtn.addEventListener('click', () => requestLogin());
  searchEl.addEventListener('input', renderCards);
  sortEl.addEventListener('change', renderCards);
</script>
```

- [ ] **Step 6: 手動で動作確認**

Task 4で保存したデータがある状態で、パラメータなしで`index.html`を開く。ログイン後、保存済みの名刺がカードで表示され、検索・並び替え・削除がそれぞれ動くことを確認する。

- [ ] **Step 7: コミット**

```bash
git add index.html src/render.js src/render.test.js
git commit -m "feat: 一覧表示・検索・並び替え・削除のUIを実装"
```

---

### Task 6: デザイン適用（NEXUAトーンへのスタイリング）

**Files:**
- Modify: `index.html`

- [ ] **Step 1: NEXUAのwelcome.htmlからCSS/Tailwind構成を参照する**

Read: `/Users/blackcoffee/WEB/XYZ/meisi/welcome.html` の `<head>`内スタイル定義（背景グラデーション・フォント指定）を確認する。

- [ ] **Step 2: index.htmlの`<head>`にTailwind CDNとスタイルを追加**

```html
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif;
    background: linear-gradient(160deg, #fff7ed 0%, #fef3f2 35%, #eff6ff 70%, #f0fdfa 100%);
  }
</style>
```

- [ ] **Step 3: 各要素にTailwindクラスを付与**

`#app`に`max-w-md mx-auto px-6 py-12`、ログインボタンに`px-6 py-3 bg-gradient-to-r from-rose-400 to-orange-400 text-white rounded-2xl font-bold shadow-lg`、カードに`bg-white/85 backdrop-blur rounded-2xl border border-white shadow-sm p-4 mb-3`など、welcome.html/help.htmlと共通のトーンを適用する（具体的なクラス名はhelp.htmlのカードスタイルを流用してよい）。

- [ ] **Step 4: 手動で見た目を確認**

保存モード・一覧モード両方をブラウザで開き、NEXUA本体と違和感のないトーンになっているか確認する。

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "style: NEXUAと統一感のあるデザインを適用"
```

---

### Task 7: エラーハンドリング

**Files:**
- Modify: `index.html`

- [ ] **Step 1: saveFlow/listFlowにtry-catchを追加**

`index.html`の`saveFlow`関数を以下に置き換える:
```js
async function saveFlow(token) {
  statusEl.textContent = '保存しています...';
  try {
    let sheet = await findSheet(token);
    if (!sheet) sheet = await createSheet(token);
    await appendBookmark(token, sheet.spreadsheetId, bookmark);
    statusEl.textContent = `「${bookmark.name || bookmark.url}」を保存しました。このタブは閉じて大丈夫です。`;
    loginBtn.style.display = 'none';
  } catch (err) {
    statusEl.textContent = '保存できませんでした。もう一度お試しください。';
    loginBtn.style.display = 'inline-block';
    loginBtn.textContent = 'もう一度試す';
  }
}
```

`listFlow`関数も同様に置き換える:
```js
async function listFlow(token) {
  statusEl.textContent = '読み込んでいます...';
  try {
    currentSheet = await findSheet(token);
    if (!currentSheet) {
      statusEl.textContent = 'まだ保存された名刺がありません';
      return;
    }
    allBookmarks = await listBookmarks(token, currentSheet.spreadsheetId);
    statusEl.style.display = 'none';
    listUi.style.display = 'block';
    renderCards();
  } catch (err) {
    statusEl.textContent = '読み込めませんでした。もう一度お試しください。';
  }
}
```

- [ ] **Step 2: initGoogleAuthのコールバックにログイン失敗時の分岐を追加**

`src/auth.js`の`initGoogleAuth`を以下に置き換える:
```js
export function initGoogleAuth(clientId, onToken, onError) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
    callback: (response) => {
      if (response.access_token) {
        onToken(response.access_token);
      } else if (onError) {
        onError(response);
      }
    },
  });
}
```

`index.html`の`initGoogleAuth`呼び出しに第3引数を追加:
```js
initGoogleAuth(GOOGLE_CLIENT_ID, (token) => {
  window.__accessToken = token;
  if (bookmark) {
    saveFlow(token);
  } else {
    listFlow(token);
  }
}, () => {
  statusEl.textContent = 'ログインできませんでした。もう一度お試しください。';
});
```

- [ ] **Step 3: 既存テストが壊れていないことを確認**

Run: `node --test src/`
Expected: PASS（全テスト、`initGoogleAuth`のシグネチャ変更はテスト対象外のためこれまでのテストに影響なし）

- [ ] **Step 4: コミット**

```bash
git add index.html src/auth.js
git commit -m "feat: ログイン・保存・読み込み失敗時のエラー表示を追加"
```

---

### Task 8: デプロイと本番E2E確認

**Files:** なし（確認作業のみ）

- [ ] **Step 1: pushしてデプロイ**

```bash
git push origin main
```

- [ ] **Step 2: GitHub Actionsの成功を確認**

```bash
gh run list --limit 1
```
Expected: `Deploy to GitHub Pages` が `success`

- [ ] **Step 3: 本番URLで保存フローをE2E確認**

本番URL（`?url=...&name=...&tags=...`付き）を開き、ログイン→保存→完了表示を確認する。

- [ ] **Step 4: 本番URLで一覧フローをE2E確認**

パラメータなしで本番URLを開き、Step 3で保存したデータが一覧に出ること、検索・削除が動くことを確認する。

---

### Task 9: NEXUA側に「保存」ボタンを追加

**Files:**
- Modify: `/Users/blackcoffee/WEB/XYZ/meisi/src/components/flipcard.jsx`

**Interfaces:**
- Consumes: Task 8で確認済みの本番URL

- [ ] **Step 1: flipcard.jsxの名刺表示部分に保存ボタンを追加**

Read: `/Users/blackcoffee/WEB/XYZ/meisi/src/components/flipcard.jsx` を確認し、名刺カードの下（既存の「Free Plan」ウォーターマークや共有ボタン付近）に以下を追加する形で実装する:

```jsx
<a
  href={`https://<username>.github.io/meishi-bookmark/?url=${encodeURIComponent(getSiteBase() + variablePart)}&name=${encodeURIComponent(personData.displayName || '')}&tags=${encodeURIComponent((personData.tags || []).join(','))}`}
  target="_blank"
  rel="noopener noreferrer"
  className="..."
>
  この名刺を保存
</a>
```

（実際のクラス名・配置はflipcard.jsxの既存パターンに合わせる。`<username>`はTask 0で作成した実際のGitHubユーザー名に置き換える）

- [ ] **Step 2: eslintとビルドを確認**

```bash
cd /Users/blackcoffee/WEB/XYZ/meisi
npx eslint src/components/flipcard.jsx
npm run build
```
Expected: エラー0件、ビルド成功

- [ ] **Step 3: session_log.mdに記録**

`docs/session_log.md`に、名刺ブックマークアプリへのリンク追加について追記する（CLAUDE.mdの記録ルールに従う）。

- [ ] **Step 4: バージョンを上げてコミット**

`src/lib/core.jsx`の`APP_VERSION`を1つ上げ、`README.md`のバージョン表記も更新してからコミットする:
```bash
git add src/components/flipcard.jsx src/lib/core.jsx README.md docs/session_log.md
git commit -m "feat: 名刺ブックマークアプリへの保存ボタンを追加"
```

- [ ] **Step 5: push（[[feedback_nexua_always_push]]の方針により確認不要）**

```bash
git push origin main
```

- [ ] **Step 6: デプロイ確認**

```bash
gh run list --limit 1
```
Expected: success。本番の名刺画面を開き、「この名刺を保存」ボタンから実際にmeishi-bookmarkアプリに遷移し、保存できることを確認する。
