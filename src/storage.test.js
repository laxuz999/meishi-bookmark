import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveLocal, listLocal, deleteLocal, deleteLocalByUrl, updateLocalMemo, updateLocalTags } from './storage.js';

// node:testにはlocalStorageがないので簡易モックを用意
beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
});

test('saveLocal: 保存したブックマークが一意なidと共にlistLocalで返る', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: '山田', tags: ['DIY'] });
  const list = listLocal();
  assert.equal(list.length, 1);
  assert.equal(list[0].url, 'https://nexua.tech/#zz1');
  assert.equal(list[0].name, '山田');
  assert.deepEqual(list[0].tags, ['DIY']);
  assert.equal(typeof list[0].id, 'string');
  assert.ok(list[0].id.length > 0);
  assert.equal(typeof list[0].savedAt, 'string');
});

test('listLocal: 何も保存していなければ空配列', () => {
  assert.deepEqual(listLocal(), []);
});

test('saveLocal: 複数回保存すると蓄積される', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: '山田', tags: [] });
  saveLocal({ url: 'https://nexua.tech/#zz2', name: '田中', tags: [] });
  const list = listLocal();
  assert.equal(list.length, 2);
});

test('saveLocal: idが重複しない', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: 'A', tags: [] });
  saveLocal({ url: 'https://nexua.tech/#zz2', name: 'B', tags: [] });
  const list = listLocal();
  assert.notEqual(list[0].id, list[1].id);
});

test('deleteLocal: 指定したidのブックマークだけ削除する', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: 'A', tags: [] });
  saveLocal({ url: 'https://nexua.tech/#zz2', name: 'B', tags: [] });
  const idToDelete = listLocal()[0].id;
  deleteLocal(idToDelete);
  const list = listLocal();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'B');
});

test('listLocal: 壊れたJSONが入っていても空配列を返す（クラッシュしない）', () => {
  localStorage.setItem('meishi_bookmarks', '{invalid json');
  assert.deepEqual(listLocal(), []);
});

test('saveLocal: memoを省略すると空文字になり、返り値は保存したエントリそのもの', () => {
  const entry = saveLocal({ url: 'https://nexua.tech/#zz1', name: '山田', tags: [] });
  assert.equal(entry.memo, '');
  assert.equal(listLocal()[0].id, entry.id);
});

test('updateLocalMemo: 指定したidのメモだけを更新する', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: 'A', tags: [] });
  const target = saveLocal({ url: 'https://nexua.tech/#zz2', name: 'B', tags: [] });
  updateLocalMemo(target.id, '展示会で交換');
  const list = listLocal();
  assert.equal(list.find(b => b.id === target.id).memo, '展示会で交換');
  assert.equal(list.find(b => b.name === 'A').memo, '');
});

test('updateLocalMemo: 存在しないidを渡してもクラッシュしない', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: 'A', tags: [] });
  assert.doesNotThrow(() => updateLocalMemo('no-such-id', 'メモ'));
  assert.equal(listLocal().length, 1);
});

test('updateLocalTags: 指定したidのタグだけを更新する', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: 'A', tags: ['旧タグ'] });
  const target = saveLocal({ url: 'https://nexua.tech/#zz2', name: 'B', tags: [] });
  updateLocalTags(target.id, ['DIY', '交流会']);
  const list = listLocal();
  assert.deepEqual(list.find(b => b.id === target.id).tags, ['DIY', '交流会']);
  assert.deepEqual(list.find(b => b.name === 'A').tags, ['旧タグ']);
});

test('updateLocalTags: 存在しないidを渡してもクラッシュしない', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: 'A', tags: [] });
  assert.doesNotThrow(() => updateLocalTags('no-such-id', ['DIY']));
  assert.equal(listLocal().length, 1);
});

// Google側で削除した名刺が、この端末のローカルデータに残ったままだと、
// 次回の差分同期（ローカルにあってGoogle側にない分をアップロード）で
// 復活してしまう不具合があったため追加した関数
test('deleteLocalByUrl: 指定したurlのエントリだけを削除する', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: 'A', tags: [] });
  saveLocal({ url: 'https://nexua.tech/#zz2', name: 'B', tags: [] });
  deleteLocalByUrl('https://nexua.tech/#zz1');
  const list = listLocal();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'B');
});

test('deleteLocalByUrl: 一致するurlがなくてもクラッシュしない', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: 'A', tags: [] });
  assert.doesNotThrow(() => deleteLocalByUrl('https://nexua.tech/#no-such-url'));
  assert.equal(listLocal().length, 1);
});

test('deleteLocalByUrl: url未指定（紙の名刺等）を渡しても全削除しない', () => {
  saveLocal({ url: 'https://nexua.tech/#zz1', name: 'A', tags: [] });
  assert.doesNotThrow(() => deleteLocalByUrl(undefined));
  assert.equal(listLocal().length, 1);
});
