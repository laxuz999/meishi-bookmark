import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createContact } from './contacts.js';

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

test('createContact: 名前・URL・タグ・メモを含めて連絡先作成APIを呼ぶ', async () => {
  mockFetch({ resourceName: 'people/c123' });
  await createContact('tok', { name: '山田太郎', url: 'https://nexua.tech/#zz1', tags: ['DIY', '釣り'], memo: '交流会で交換' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /people:createContact/);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.names[0].givenName, '山田太郎');
  assert.equal(body.urls[0].value, 'https://nexua.tech/#zz1');
  assert.match(body.biographies[0].value, /NEXUA名刺: https:\/\/nexua\.tech\/#zz1/);
  assert.match(body.biographies[0].value, /タグ: DIY・釣り/);
  assert.match(body.biographies[0].value, /メモ: 交流会で交換/);
});

test('createContact: 名前未設定の場合はフォールバック名を使う', async () => {
  mockFetch({});
  await createContact('tok', { url: 'https://nexua.tech/#zz1', tags: [], memo: '' });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.names[0].givenName, '名前未設定の名刺');
});

test('createContact: タグ・メモが空ならbiographiesを含めない', async () => {
  mockFetch({});
  await createContact('tok', { name: 'A', url: 'https://nexua.tech/#zz1', tags: [], memo: '' });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.biographies[0].value, 'NEXUA名刺: https://nexua.tech/#zz1');
});

test('createContact: 401エラーの場合はエラーをthrowする', async () => {
  mockFetch({ error: { message: 'Invalid Credentials' } }, 401);
  await assert.rejects(
    () => createContact('tok', { name: 'A', url: 'https://nexua.tech/#zz1', tags: [], memo: '' }),
    /Google API error \(401\): Invalid Credentials/
  );
});
