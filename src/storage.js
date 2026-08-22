// 認証不要のローカル保存（この端末のブラウザ内にのみ保存、複数端末では共有されない）
const STORAGE_KEY = 'meishi_bookmarks';

function readAll() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function saveLocal(bookmark) {
  const list = readAll();
  const entry = {
    id: generateId(),
    url: bookmark.url,
    name: bookmark.name || '',
    tags: bookmark.tags || [],
    memo: bookmark.memo || '',
    savedAt: new Date().toISOString(),
  };
  list.push(entry);
  writeAll(list);
  return entry;
}

export function listLocal() {
  return readAll();
}

export function deleteLocal(id) {
  writeAll(readAll().filter((b) => b.id !== id));
}

// Google側で削除した名刺を、この端末のローカルデータからも削除するための関数。
// ローカルとGoogle側はurlをキーに対応づいているため、idではなくurlで探す。
// これをしないと、Google側で削除→この端末では消えないまま残る→次回の
// 差分同期（ローカルにあってGoogle側にない分をアップロード）で復活してしまう
export function deleteLocalByUrl(url) {
  if (!url) return;
  writeAll(readAll().filter((b) => b.url !== url));
}

// 保存後に「ひとことメモ」だけを追記・上書きするための更新関数
export function updateLocalMemo(id, memo) {
  const list = readAll();
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], memo };
  writeAll(list);
}

// 保存後にタグだけを追記・上書きするための更新関数
export function updateLocalTags(id, tags) {
  const list = readAll();
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], tags };
  writeAll(list);
}
