// alert()/confirm()の代替（ブラウザ標準のものはURLがダイアログに出てしまうため、
// 自前モーダルで表示する）。index.htmlとpaper-card.htmlの両方が同じマークアップ
// (#app-dialog-modal / #app-dialog-message / #app-dialog-cancel / #app-dialog-ok)
// を持っている前提で、そのページのDOM要素を掴んで動かす。
export function createAppDialog() {
  const dialogModalEl = document.getElementById('app-dialog-modal');
  const dialogMessageEl = document.getElementById('app-dialog-message');
  const dialogCancelBtn = document.getElementById('app-dialog-cancel');
  const dialogOkBtn = document.getElementById('app-dialog-ok');

  function appAlert(message) {
    return new Promise((resolve) => {
      dialogMessageEl.textContent = message;
      dialogCancelBtn.style.display = 'none';
      dialogModalEl.style.display = 'flex';
      const onOk = () => {
        dialogModalEl.style.display = 'none';
        dialogOkBtn.removeEventListener('click', onOk);
        resolve();
      };
      dialogOkBtn.addEventListener('click', onOk);
    });
  }

  function appConfirm(message) {
    return new Promise((resolve) => {
      dialogMessageEl.textContent = message;
      dialogCancelBtn.style.display = 'block';
      dialogModalEl.style.display = 'flex';
      const cleanup = () => {
        dialogModalEl.style.display = 'none';
        dialogOkBtn.removeEventListener('click', onOk);
        dialogCancelBtn.removeEventListener('click', onCancel);
      };
      const onOk = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };
      dialogOkBtn.addEventListener('click', onOk);
      dialogCancelBtn.addEventListener('click', onCancel);
    });
  }

  return { appAlert, appConfirm };
}
