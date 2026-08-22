const SHEET_NAME = 'NEXUAブックマーク';
const TAB_NAME = 'bookmarks';
const HEADER = ['url', 'name', 'tags', 'savedAt', 'memo', 'photoUrl', 'frontPhotoUrl', 'backPhotoUrl'];

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function checkOk(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Google API error (${res.status}): ${body.error?.message || res.statusText}`);
  }
}

// 既存シートのヘッダーが古い列数のまま（過去の機能追加前に作られた等）だった場合、
// 見た目上どの列が何か分からなくなるため、不足分を補って最新のヘッダーに揃える
async function ensureHeader(token, spreadsheetId) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A1:H1`, {
    headers: authHeader(token),
  });
  await checkOk(res);
  const data = await res.json();
  const current = data.values?.[0] || [];
  if (current.length >= HEADER.length) return;
  const headerRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A1:H1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [HEADER] }),
  });
  await checkOk(headerRes);
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
  await ensureHeader(token, spreadsheetId);
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

  const headerRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A1:H1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [HEADER] }),
  });
  await checkOk(headerRes);

  return { spreadsheetId, gid };
}

// values.append は「既存の表の幅」をGoogle側が自動検出して書き込み先を決めるため、
// 表の幅がヘッダーと食い違っている（過去にG/H列を使ったことがない等）シートでは
// 列がズレて書き込まれることがある（実際に発生した不具合）。
// 現在のA列のデータ行数を数え、その次の行番号へ直接PUTすることでズレを防ぐ
async function getNextRowIndex(token, spreadsheetId) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A:A`, {
    headers: authHeader(token),
  });
  await checkOk(res);
  const data = await res.json();
  const rows = data.values || [];
  return rows.length + 1;
}

export async function appendBookmark(token, spreadsheetId, bookmark) {
  const row = [
    bookmark.url || '',
    bookmark.name,
    (bookmark.tags || []).join(','),
    new Date().toISOString(),
    bookmark.memo || '',
    bookmark.photoUrl || '',
    bookmark.frontPhotoUrl || '',
    bookmark.backPhotoUrl || '',
  ];
  const nextRow = await getNextRowIndex(token, spreadsheetId);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A${nextRow}:H${nextRow}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  await checkOk(res);
}

export async function listBookmarks(token, spreadsheetId) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!A2:H`, {
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
    photoUrl: row[5] || '',
    frontPhotoUrl: row[6] || '',
    backPhotoUrl: row[7] || '',
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

export async function updatePhotoUrl(token, spreadsheetId, rowIndex, photoUrl) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TAB_NAME}!F${rowIndex}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[photoUrl]] }),
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
