export function parseBookmarkParams(searchParams) {
  const url = searchParams.get('url');
  if (!url) return null;
  const name = searchParams.get('name') || '';
  const tagsRaw = searchParams.get('tags') || '';
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  return { url, name, tags };
}
