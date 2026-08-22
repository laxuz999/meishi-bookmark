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
