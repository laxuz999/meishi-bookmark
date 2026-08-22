import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { uploadPhoto } from './drive.js';

let originalFetch;
let calls;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchSequence(responses) {
  let i = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      status: r.status ?? 200,
      ok: (r.status ?? 200) < 400,
      statusText: '',
      json: async () => r.body ?? {},
    };
  };
}

test('uploadPhoto: アップロード後に共有設定し、閲覧用URLを返す', async () => {
  mockFetchSequence([
    { body: { id: 'file123' } },
    { body: {} },
  ]);
  const blob = new Blob(['dummy'], { type: 'image/jpeg' });
  const url = await uploadPhoto('tok', blob, 'photo.jpg');
  assert.equal(url, 'https://drive.google.com/thumbnail?id=file123&sz=w1000');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /upload\/drive\/v3\/files\?uploadType=multipart/);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
  assert.match(calls[1].url, /files\/file123\/permissions/);
  const permBody = JSON.parse(calls[1].options.body);
  assert.equal(permBody.role, 'reader');
  assert.equal(permBody.type, 'anyone');
});

test('uploadPhoto: アップロード自体が失敗したらエラーをthrowする（共有設定は呼ばない）', async () => {
  mockFetchSequence([
    { status: 401, body: { error: { message: 'Invalid Credentials' } } },
  ]);
  const blob = new Blob(['dummy'], { type: 'image/jpeg' });
  await assert.rejects(
    () => uploadPhoto('tok', blob, 'photo.jpg'),
    /Google API error \(401\): Invalid Credentials/
  );
  assert.equal(calls.length, 1);
});

test('uploadPhoto: 共有設定が失敗したらエラーをthrowする', async () => {
  mockFetchSequence([
    { body: { id: 'file123' } },
    { status: 403, body: { error: { message: 'Permission denied' } } },
  ]);
  const blob = new Blob(['dummy'], { type: 'image/jpeg' });
  await assert.rejects(
    () => uploadPhoto('tok', blob, 'photo.jpg'),
    /Google API error \(403\): Permission denied/
  );
});
