// 「表示テキスト＋編集ボタン → 入力欄＋保存/キャンセル」というインライン編集行の
// 共通コンポーネント。タグ・メモの編集で、index.html(通常カード)と
// paper-card.html(紙の名刺カード)が同じUI・挙動を使うための共通化。
//
// 呼び出し側は #cards / #paper-cards 側で定義済みの
// .memo-row / .memo-text / .memo-edit-btn / .memo-edit-area / .memo-save-btn /
// .memo-cancel-btn のCSSクラスに依存する。
export function renderEditableRow(card, opts) {
  const row = document.createElement('div');
  row.className = 'memo-row';
  const textEl = document.createElement('span');
  textEl.className = 'memo-text' + (opts.isEmpty ? ' placeholder' : '');
  textEl.textContent = opts.displayText;
  const editBtn = document.createElement('button');
  editBtn.className = 'memo-edit-btn';
  editBtn.textContent = opts.editLabel;
  row.appendChild(textEl);
  row.appendChild(editBtn);
  card.appendChild(row);

  editBtn.addEventListener('click', () => {
    const editArea = document.createElement('div');
    editArea.className = 'memo-edit-area';
    const input = document.createElement(opts.isTextarea ? 'textarea' : 'input');
    if (opts.isTextarea) {
      input.rows = 2;
    } else {
      input.type = 'text';
      if (opts.inputPlaceholder) input.placeholder = opts.inputPlaceholder;
    }
    input.value = opts.inputValue;
    const actions = document.createElement('div');
    actions.className = 'memo-edit-actions';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'memo-save-btn';
    saveBtn.textContent = '保存';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'memo-cancel-btn';
    cancelBtn.textContent = 'キャンセル';
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    editArea.appendChild(input);
    editArea.appendChild(actions);
    card.replaceChild(editArea, row);
    input.focus();

    cancelBtn.addEventListener('click', () => {
      card.replaceChild(row, editArea);
    });
    saveBtn.addEventListener('click', async () => {
      try {
        await opts.onSave(input.value);
      } catch (err) {
        await opts.onSaveError(err);
      }
    });
  });

  return row;
}
