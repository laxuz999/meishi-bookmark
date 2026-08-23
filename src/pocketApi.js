// 合言葉方式の同期バックエンド(GAS Web App)への薄いAPIクライアント。
// Content-Type: text/plain でPOSTするのは、application/jsonだとブラウザが
// CORSプリフライト(OPTIONS)を送り、GAS Web Appはそれに正しく応答できず
// ブロックされてしまうため（GAS側はpostData.contentsから直接JSON.parseするので
// text/plainでも支障ない）
const API_URL = 'https://script.google.com/macros/s/AKfycbyelJf8EEuEIWUiwrp2l8TFddL5jXemE-EKxDUeeJnQIxJpRsmPaaqh2eCHVLOXTEWj/exec';

async function callApi(payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export function issueCode() {
  return callApi({ action: 'issue_code' });
}

export function getBookmarks(code) {
  return callApi({ action: 'get_bookmarks', code });
}

export function saveBookmarks(code, bookmarks) {
  return callApi({ action: 'save_bookmarks', code, bookmarks });
}

// 「紙の名刺」= URLが無く、表面写真があるエントリのみを指す。
// index.html（通常の名刺一覧）とpaper-card.html（紙の名刺一覧）の
// 両方が同じ判定を使うことで、片方だけ直して表示がズレるのを防ぐ
export function isPaperCard(bookmark) {
  return !bookmark.url && !!bookmark.frontPhotoUrl;
}
