// Google Drive API — メモに添付する写真のアップロード（drive.fileスコープで動作）

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function checkOk(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Google API error (${res.status}): ${body.error?.message || res.statusText}`);
  }
}

// blob(圧縮済みの画像)をこのアプリが作成したファイルとしてDriveへアップロードし、
// 「リンクを知っている人は閲覧可」に設定してから、<img>で直接表示できるURLを返す
export async function uploadPhoto(token, blob, filename) {
  const metadata = { name: filename };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: authHeader(token),
    body: form,
  });
  await checkOk(res);
  const data = await res.json();
  const fileId = data.id;

  const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  await checkOk(permRes);

  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}
