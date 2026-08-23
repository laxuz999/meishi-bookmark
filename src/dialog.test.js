import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAppDialog } from './dialog.js';

// node:testにはDOMがないため、createAppDialogが使うAPIだけの簡易モックを用意
// （storage.test.jsのlocalStorageモックと同じ方針）
function makeElement() {
  const listeners = {};
  return {
    textContent: '',
    style: {},
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    dispatch(type) {
      (listeners[type] || []).forEach((fn) => fn());
    },
  };
}

let els;
beforeEach(() => {
  els = {
    'app-dialog-modal': makeElement(),
    'app-dialog-message': makeElement(),
    'app-dialog-cancel': makeElement(),
    'app-dialog-ok': makeElement(),
  };
  globalThis.document = {
    getElementById: (id) => els[id],
  };
});

test('appAlert: メッセージを表示し、キャンセルボタンは隠してOKだけ待つ', async () => {
  const { appAlert } = createAppDialog();
  const p = appAlert('テストメッセージ');
  assert.equal(els['app-dialog-message'].textContent, 'テストメッセージ');
  assert.equal(els['app-dialog-cancel'].style.display, 'none');
  assert.equal(els['app-dialog-modal'].style.display, 'flex');
  els['app-dialog-ok'].dispatch('click');
  await p;
  assert.equal(els['app-dialog-modal'].style.display, 'none');
});

test('appConfirm: OKを押すとtrueで解決される', async () => {
  const { appConfirm } = createAppDialog();
  const p = appConfirm('本当に削除しますか？');
  assert.equal(els['app-dialog-cancel'].style.display, 'block');
  els['app-dialog-ok'].dispatch('click');
  assert.equal(await p, true);
});

test('appConfirm: キャンセルを押すとfalseで解決される', async () => {
  const { appConfirm } = createAppDialog();
  const p = appConfirm('本当に削除しますか？');
  els['app-dialog-cancel'].dispatch('click');
  assert.equal(await p, false);
});
