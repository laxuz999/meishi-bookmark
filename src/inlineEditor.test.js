import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEditableRow } from './inlineEditor.js';
import { makeElement } from './testDom.js';

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
  // onSave自体の完了をPromiseで待つ（マイクロタスクのホップ数を決め打ちしない）
  let resolveSaved;
  const saved = new Promise((resolve) => { resolveSaved = resolve; });
  setupWithDocument(card, baseOpts({
    onSave: async (raw) => { savedValue = raw; resolveSaved(); },
  }));
  const row = card.children[0];
  row.children[1].dispatch('click');
  const editArea = card.children[0];
  const input = editArea.children[0];
  input.value = 'DIY,新タグ';
  const saveBtn = editArea.children[1].children[0];
  assert.equal(saveBtn.textContent, '保存');
  saveBtn.dispatch('click');
  await saved;
  assert.equal(savedValue, 'DIY,新タグ');
});

test('renderEditableRow: onSaveが失敗したらonSaveErrorが呼ばれる', async () => {
  const card = makeElement('div');
  let caughtErr;
  let resolveHandled;
  const handled = new Promise((resolve) => { resolveHandled = resolve; });
  setupWithDocument(card, baseOpts({
    onSave: async () => { throw new Error('保存に失敗しました'); },
    onSaveError: async (err) => { caughtErr = err; resolveHandled(); },
  }));
  const row = card.children[0];
  row.children[1].dispatch('click');
  const editArea = card.children[0];
  const saveBtn = editArea.children[1].children[0];
  saveBtn.dispatch('click');
  await handled;
  assert.equal(caughtErr.message, '保存に失敗しました');
});
