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
