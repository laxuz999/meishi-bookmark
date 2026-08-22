const SHEET_NAME = 'NEXUAブックマーク';
const TAB_NAME = 'bookmarks';

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function checkOk(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Google API error (${res.status}): ${body.error?.message || res.statusText}`);
  }
}

export async function findSheet(token) {
  const q = encodeURIComponent(`name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}`, {
    headers: authHeader(token),
  });
  await checkOk(res);
  const data = await res.json();
  if (!data.files || data.files.length === 0) return null;
  const spreadsheetId = data.files[0].id;
  // gidは決め打ちせず、実際のシートのsheetIdを取得する
  // （決め打ち0のままだと、何らかの理由でシートの実gidが0でない場合に
  //   削除・更新APIが誤ったシートを指定してしまう）
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.sheetId`, {
    headers: authHeader(token),
  });
  await checkOk(metaRes);
  const meta = await metaRes.json();
  const gid = meta.sheets?.[0]?.properties?.sheetId ?? 0;
  return { spreadsheetId, gid };
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
  await checkOk(res);
  const data = await res.json();
  const spreadsheetId = data.spreadsheetId;
  const gid = data.sheets[0].properties.sheetId;

  const headerRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A1:E1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [['url', 'name', 'tags', 'savedAt', 'memo']] }),
  });
  await checkOk(headerRes);

  return { spreadsheetId, gid };
}

export async function appendBookmark(token, spreadsheetId, bookmark) {
  const row = [bookmark.url, bookmark.name, (bookmark.tags || []).join(','), new Date().toISOString(), bookmark.memo || ''];
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A:E:append?valueInputOption=RAW`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  await checkOk(res);
}

export async function listBookmarks(token, spreadsheetId) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A2:E`, {
    headers: authHeader(token),
  });
  await checkOk(res);
  const data = await res.json();
  const values = data.values || [];
  return values.map((row, i) => ({
    rowIndex: i + 2,
    url: row[0] || '',
    name: row[1] || '',
    tags: (row[2] || '').split(',').map(t => t.trim()).filter(Boolean),
    savedAt: row[3] || '',
    memo: row[4] || '',
  }));
}

export async function updateMemo(token, spreadsheetId, rowIndex, memo) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!E${rowIndex}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[memo]] }),
  });
  await checkOk(res);
}

export async function deleteBookmark(token, spreadsheetId, gid, rowIndex) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
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
  await checkOk(res);
}
