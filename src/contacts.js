// Google People API — 保存した名刺をGoogle連絡先へワンタップ追加する

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function checkOk(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Google API error (${res.status}): ${body.error?.message || res.statusText}`);
  }
}

// bookmarkのurl・タグ・メモを、連絡先の「メモ」欄にまとめて書き込む
function buildNote(bookmark) {
  const lines = [];
  if (bookmark.url) lines.push(`NEXUA名刺: ${bookmark.url}`);
  if (bookmark.tags && bookmark.tags.length > 0) lines.push(`タグ: ${bookmark.tags.join('・')}`);
  if (bookmark.memo) lines.push(`メモ: ${bookmark.memo}`);
  return lines.join('\n');
}

export async function createContact(token, bookmark) {
  const note = buildNote(bookmark);
  const body = {
    names: [{ givenName: bookmark.name || '名前未設定の名刺' }],
  };
  if (bookmark.url) {
    body.urls = [{ value: bookmark.url, type: 'other' }];
  }
  if (note) {
    body.biographies = [{ value: note, contentType: 'TEXT_PLAIN' }];
  }

  const res = await fetch('https://people.googleapis.com/v1/people:createContact', {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await checkOk(res);
  return res.json();
}
