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
