const SHEET_NAME = 'NEXUAブックマーク';
const TAB_NAME = 'bookmarks';

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

export async function findSheet(token) {
  const q = encodeURIComponent(`name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}`, {
    headers: authHeader(token),
  });
  const data = await res.json();
  if (!data.files || data.files.length === 0) return null;
  const spreadsheetId = data.files[0].id;
  return { spreadsheetId, gid: 0 };
}

export async function createSheet(token) {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: SHEET_NAME },
      sheets: [{ properties: { title: TAB_NAME } }],
    }),
  });
  const data = await res.json();
  const spreadsheetId = data.spreadsheetId;
  const gid = data.sheets[0].properties.sheetId;

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A1:D1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [['url', 'name', 'tags', 'savedAt']] }),
  });

  return { spreadsheetId, gid };
}

export async function appendBookmark(token, spreadsheetId, bookmark) {
  const row = [bookmark.url, bookmark.name, (bookmark.tags || []).join(','), new Date().toISOString()];
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A:D:append?valueInputOption=RAW`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
}

export async function listBookmarks(token, spreadsheetId) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A2:D`, {
    headers: authHeader(token),
  });
  const data = await res.json();
  const values = data.values || [];
  return values.map((row, i) => ({
    rowIndex: i + 2,
    url: row[0] || '',
    name: row[1] || '',
    tags: (row[2] || '').split(',').map(t => t.trim()).filter(Boolean),
    savedAt: row[3] || '',
  }));
}

export async function deleteBookmark(token, spreadsheetId, gid, rowIndex) {
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId: gid, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex },
        },
      }],
    }),
  });
}
