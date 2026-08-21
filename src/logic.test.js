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
