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
  constructor() { this.rows = []; }
  getDataRange() { return { getValues: () => this.rows.map((r) => [...r]) }; }
  appendRow(r) { this.rows.push([...r]); }
  getLastRow() { return this.rows.length; }
  // 単一セル: getRange(row, col) / 範囲: getRange(row, col, numRows, numCols)
  getRange(r, c, numRows, numCols) {
    const self = this;
    if (numRows !== undefined) {
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

beforeEach(() => {
  const sheets = {};
  const spreadsheets = {}; // ID -> { sheets: {...}, getId: () => id } の形式
  let nextSpreadsheetId = 1;
  const scriptProps = {}; // PropertiesServiceが永続的に保存するデータ

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

test('doGET: issue_code（write系）はMETHOD_NOT_ALLOWEDエラー', () => {
  const res = get({ action: 'issue_code' });
  assert.equal(res.success, false);
  assert.equal(res.code, 'METHOD_NOT_ALLOWED');
});

test('doGET: save_bookmarks（write系）はMETHOD_NOT_ALLOWEDエラー', () => {
  const res = get({ action: 'save_bookmarks', code: 'DUMMY', bookmarks: [] });
  assert.equal(res.success, false);
  assert.equal(res.code, 'METHOD_NOT_ALLOWED');
});

test('doGET: get_bookmarks（read系）はPOSTと同じく動作可能', () => {
  // POSTで合言葉を発行
  const { code } = post({ action: 'issue_code' });
  post({ action: 'save_bookmarks', code, bookmarks: [{ url: 'test', name: 'テスト' }] });
  // GETでget_bookmarksを呼び出し
  const res = get({ action: 'get_bookmarks', code });
  assert.equal(res.success, true);
  assert.equal(res.bookmarks.length, 1);
  assert.equal(res.bookmarks[0].name, 'テスト');
});
