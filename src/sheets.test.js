import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { findSheet, createSheet, appendBookmark, listBookmarks, updateMemo, updatePhotoUrl, deleteBookmark } from './sheets.js';

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
      ok: status < 400,
      statusText: '',
      json: async () => responseBody,
    };
  };
}

test('findSheet: 既存シートが見つかれば実際のgidを取得して返す', async () => {
  let call = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    call++;
    if (call === 1) return { status: 200, ok: true, json: async () => ({ files: [{ id: 'sheet123' }] }) };
    return { status: 200, ok: true, json: async () => ({ sheets: [{ properties: { sheetId: 42 } }] }) };
  };
  const result = await findSheet('tok');
  assert.equal(result.spreadsheetId, 'sheet123');
  assert.equal(result.gid, 42);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /drive\/v3\/files/);
  assert.match(calls[1].url, /spreadsheets\/sheet123/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
});

test('findSheet: 見つからなければnullを返す（シート情報取得は呼ばない）', async () => {
  mockFetch({ files: [] });
  const result = await findSheet('tok');
  assert.equal(result, null);
  assert.equal(calls.length, 1);
});

test('createSheet: 新規作成してヘッダー行を書き込む', async () => {
  let call = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    call++;
    if (call === 1) {
      return { status: 200, ok: true, json: async () => ({ spreadsheetId: 'newid', sheets: [{ properties: { sheetId: 0 } }] }) };
    }
    return { status: 200, ok: true, json: async () => ({}) };
  };
  const result = await createSheet('tok');
  assert.equal(result.spreadsheetId, 'newid');
  assert.equal(result.gid, 0);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /values\/bookmarks!A1:H1/);
});

test('appendBookmark: 行を追記するAPIを呼ぶ', async () => {
  mockFetch({});
  await appendBookmark('tok', 'sheet123', {
    url: 'https://nexua.tech/#zz1', name: '山田', tags: ['DIY', '釣り'], memo: '展示会で交換',
    photoUrl: 'https://drive.google.com/uc?export=view&id=abc',
    frontPhotoUrl: 'https://drive.google.com/thumbnail?id=front1', backPhotoUrl: 'https://drive.google.com/thumbnail?id=back1',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /values\/bookmarks!A:H:append/);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.values[0][0], 'https://nexua.tech/#zz1');
  assert.equal(body.values[0][1], '山田');
  assert.equal(body.values[0][2], 'DIY,釣り');
  assert.equal(body.values[0][4], '展示会で交換');
  assert.equal(body.values[0][5], 'https://drive.google.com/uc?export=view&id=abc');
  assert.equal(body.values[0][6], 'https://drive.google.com/thumbnail?id=front1');
  assert.equal(body.values[0][7], 'https://drive.google.com/thumbnail?id=back1');
});

test('appendBookmark: url省略・memo・photoUrl等省略時は空文字を送る（紙の名刺登録を想定）', async () => {
  mockFetch({});
  await appendBookmark('tok', 'sheet123', { name: '山田', tags: [] });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.values[0][0], '');
  assert.equal(body.values[0][4], '');
  assert.equal(body.values[0][5], '');
  assert.equal(body.values[0][6], '');
  assert.equal(body.values[0][7], '');
});

test('listBookmarks: 行データをオブジェクト配列に変換する（rowIndexはヘッダー分+2から）', async () => {
  mockFetch({ values: [
    ['https://nexua.tech/#zz1', '山田', 'DIY,釣り', '2026-08-21T00:00:00.000Z', '展示会で交換', 'https://drive.google.com/uc?export=view&id=abc', 'https://drive.google.com/thumbnail?id=front1', 'https://drive.google.com/thumbnail?id=back1'],
    ['https://nexua.tech/#zz2', '田中', '', '2026-08-22T00:00:00.000Z'],
  ]});
  const result = await listBookmarks('tok', 'sheet123');
  assert.equal(result.length, 2);
  assert.equal(result[0].rowIndex, 2);
  assert.deepEqual(result[0].tags, ['DIY', '釣り']);
  assert.equal(result[0].memo, '展示会で交換');
  assert.equal(result[0].photoUrl, 'https://drive.google.com/uc?export=view&id=abc');
  assert.equal(result[0].frontPhotoUrl, 'https://drive.google.com/thumbnail?id=front1');
  assert.equal(result[0].backPhotoUrl, 'https://drive.google.com/thumbnail?id=back1');
  assert.equal(result[1].rowIndex, 3);
  assert.deepEqual(result[1].tags, []);
  assert.equal(result[1].memo, '');
  assert.equal(result[1].photoUrl, '');
  assert.equal(result[1].frontPhotoUrl, '');
  assert.equal(result[1].backPhotoUrl, '');
});

test('listBookmarks: データが無ければ空配列', async () => {
  mockFetch({});
  const result = await listBookmarks('tok', 'sheet123');
  assert.deepEqual(result, []);
});

test('findSheet: 401エラーの場合はエラーをthrowする', async () => {
  mockFetch({ error: { message: 'Invalid Credentials' } }, 401);
  await assert.rejects(
    () => findSheet('tok'),
    /Google API error \(401\): Invalid Credentials/
  );
});

test('updateMemo: 指定行のE列だけを更新するAPIを呼ぶ', async () => {
  mockFetch({});
  await updateMemo('tok', 'sheet123', 3, '交流会で交換');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /values\/bookmarks!E3/);
  assert.equal(calls[0].options.method, 'PUT');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.values, [['交流会で交換']]);
});

test('updatePhotoUrl: 指定行のF列だけを更新するAPIを呼ぶ', async () => {
  mockFetch({});
  await updatePhotoUrl('tok', 'sheet123', 3, 'https://drive.google.com/uc?export=view&id=abc');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /values\/bookmarks!F3/);
  assert.equal(calls[0].options.method, 'PUT');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.values, [['https://drive.google.com/uc?export=view&id=abc']]);
});

test('deleteBookmark: 行削除のbatchUpdateを呼ぶ', async () => {
  mockFetch({});
  await deleteBookmark('tok', 'sheet123', 0, 3);
  assert.match(calls[0].url, /sheet123:batchUpdate/);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.requests[0].deleteDimension.range.startIndex, 2);
  assert.equal(body.requests[0].deleteDimension.range.endIndex, 3);
});
