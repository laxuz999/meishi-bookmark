export function filterAndSort(bookmarks, query, sortOrder) {
  const q = (query || '').trim().toLowerCase();
  let result = q
    ? bookmarks.filter(b => b.name.toLowerCase().includes(q))
    : bookmarks.slice();
  result.sort((a, b) => {
    const diff = new Date(a.savedAt) - new Date(b.savedAt);
    return sortOrder === 'oldest' ? diff : -diff;
  });
  return result;
}
