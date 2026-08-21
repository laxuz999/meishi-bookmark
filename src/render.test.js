import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSort } from './render.js';

const sample = [
  { name: '山田太郎', url: 'https://nexua.tech/#zz1', tags: ['DIY'], memo: '', savedAt: '2026-08-20T00:00:00.000Z' },
  { name: '田中花子', url: 'https://nexua.tech/#zz2', tags: ['釣り'], memo: '〇〇交流会で名刺交換', savedAt: '2026-08-21T00:00:00.000Z' },
];

test('queryで名前を絞り込める', () => {
  const result = filterAndSort(sample, '山田', 'newest');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, '山田太郎');
});

test('queryでタグを絞り込める', () => {
  const result = filterAndSort(sample, 'DIY', 'newest');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, '山田太郎');
});

test('queryでメモを絞り込める', () => {
  const result = filterAndSort(sample, '交流会', 'newest');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, '田中花子');
});

test('tagsやmemoが未定義でもクラッシュしない', () => {
  const noExtra = [{ name: '鈴木', url: 'https://nexua.tech/#zz3', savedAt: '2026-08-19T00:00:00.000Z' }];
  const result = filterAndSort(noExtra, '鈴木', 'newest');
  assert.equal(result.length, 1);
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
