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
  list.push({
    id: generateId(),
    url: bookmark.url,
    name: bookmark.name || '',
    tags: bookmark.tags || [],
    savedAt: new Date().toISOString(),
  });
  writeAll(list);
}

export function listLocal() {
  return readAll();
}

export function deleteLocal(id) {
  writeAll(readAll().filter((b) => b.id !== id));
}
