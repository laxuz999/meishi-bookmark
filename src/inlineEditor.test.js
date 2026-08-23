import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEditableRow } from './inlineEditor.js';

// node:testにはDOMがないため、renderEditableRowが使うAPIだけの簡易モックを
// 用意する（storage.test.jsのlocalStorageモックと同じ方針）。実際のブラウザ
// 描画・見た目の確認はPlaywrightでの実機確認に任せ、ここでは状態遷移
// （表示→編集→保存/キャンセル）のロジックだけを検証する
function makeElement(tag) {
  const listeners = {};
  return {
    tagName: tag,
    className: '',
    textContent: '',
    value: '',
    style: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChild(newChild, oldChild) {
      const i = this.children.indexOf(oldChild);
      if (i !== -1) this.children[i] = newChild;
      return oldChild;
    },
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    dispatch(type) {
      (listeners[type] || []).forEach((fn) => fn());
    },
    focus() {},
  };
}

function baseOpts(overrides) {
  return {
    displayText: 'DIY・交流会',
    isEmpty: false,
    editLabel: '編集',
    isTextarea: false,
    inputValue: 'DIY,交流会',
    inputPlaceholder: '例：DIY,交流会',
    onSave: async () => {},
    onSaveError: async () => {},
    ...overrides,
  };
}

function setupWithDocument(card, opts) {
  globalThis.document = { createElement: (tag) => makeElement(tag) };
  return renderEditableRow(card, opts);
}

test('renderEditableRow: 表示テキストと編集ラベルをそのまま出す', () => {
  const card = makeElement('div');
  setupWithDocument(card, baseOpts());
  const row = card.children[0];
  const [textEl, editBtn] = row.children;
  assert.equal(textEl.textContent, 'DIY・交流会');
  assert.equal(textEl.className, 'memo-text');
  assert.equal(editBtn.textContent, '編集');
});

test('renderEditableRow: isEmptyの時はplaceholderクラスが付く', () => {
  const card = makeElement('div');
  setupWithDocument(card, baseOpts({ displayText: 'タグなし', isEmpty: true, editLabel: '+ タグを追加' }));
  const [textEl] = card.children[0].children;
  assert.equal(textEl.className, 'memo-text placeholder');
});

test('renderEditableRow: isTextarea=falseだとinput、trueだとtextareaを開く', () => {
  const card1 = makeElement('div');
  setupWithDocument(card1, baseOpts({ isTextarea: false }));
  const row1 = card1.children[0];
  const editBtn1 = row1.children[1];
  editBtn1.dispatch('click');
  const input = card1.children[0].children[0];
  assert.equal(input.tagName, 'input');
  assert.equal(input.type, 'text');
  assert.equal(input.placeholder, '例：DIY,交流会');
  assert.equal(input.value, 'DIY,交流会');

  const card2 = makeElement('div');
  setupWithDocument(card2, baseOpts({ isTextarea: true, inputValue: 'メモ本文' }));
  const row2 = card2.children[0];
  const editBtn2 = row2.children[1];
  editBtn2.dispatch('click');
  const textarea = card2.children[0].children[0];
  assert.equal(textarea.tagName, 'textarea');
  assert.equal(textarea.rows, 2);
  assert.equal(textarea.value, 'メモ本文');
});

test('renderEditableRow: キャンセルで表示行に戻る', () => {
  const card = makeElement('div');
  setupWithDocument(card, baseOpts());
  const row = card.children[0];
  row.children[1].dispatch('click');
  const editArea = card.children[0];
  const cancelBtn = editArea.children[1].children[1];
  assert.equal(cancelBtn.textContent, 'キャンセル');
  cancelBtn.dispatch('click');
  assert.equal(card.children[0], row);
});

test('renderEditableRow: 保存を押すと入力値でonSaveが呼ばれる', async () => {
  const card = makeElement('div');
  let savedValue;
  setupWithDocument(card, baseOpts({
    onSave: async (raw) => { savedValue = raw; },
  }));
  const row = card.children[0];
  row.children[1].dispatch('click');
  const editArea = card.children[0];
  const input = editArea.children[0];
  input.value = 'DIY,新タグ';
  const saveBtn = editArea.children[1].children[0];
  assert.equal(saveBtn.textContent, '保存');
  saveBtn.dispatch('click');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(savedValue, 'DIY,新タグ');
});

test('renderEditableRow: onSaveが失敗したらonSaveErrorが呼ばれる', async () => {
  const card = makeElement('div');
  let caughtErr;
  setupWithDocument(card, baseOpts({
    onSave: async () => { throw new Error('保存に失敗しました'); },
    onSaveError: async (err) => { caughtErr = err; },
  }));
  const row = card.children[0];
  row.children[1].dispatch('click');
  const editArea = card.children[0];
  const saveBtn = editArea.children[1].children[0];
  saveBtn.dispatch('click');
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(caughtErr.message, '保存に失敗しました');
});
