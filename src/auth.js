let tokenClient = null;

export function initGoogleAuth(clientId, onToken, onError) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    // v2: spreadsheets(機密スコープ・要審査)を外しdrive.file単独に。
    // Sheets APIのvalues.append/batchUpdate等は、対象シートがこのアプリ自身の
    // 作成物であればdrive.fileスコープだけで動作する（findSheet/createSheetの
    // フロー上、常にアプリが作成したシートしか触らない設計のため問題ない）
    scope: 'https://www.googleapis.com/auth/drive.file',
    callback: (response) => {
      if (response.access_token) {
        onToken(response.access_token);
      } else if (onError) {
        onError(response);
      }
    },
  });
}

export function requestLogin() {
  if (!tokenClient) throw new Error('initGoogleAuthが先に呼ばれていません');
  tokenClient.requestAccessToken();
}

// 既に連携済みの端末で、ポップアップやアカウント選択を出さずにトークン再取得を試みる。
// ユーザーがそのブラウザでGoogleにログイン済み・かつ過去にこのアプリへ同意済みなら
// 無操作で成功し、そうでなければ黙って失敗する（呼び出し元がonErrorで通常のボタン表示に戻す）
export function requestSilentLogin() {
  if (!tokenClient) throw new Error('initGoogleAuthが先に呼ばれていません');
  tokenClient.requestAccessToken({ prompt: '' });
}

// 「Google連絡先に追加」専用のトークンクライアント（drive.fileとは別スコープ・別クライアント）。
// 同期に必須ではない機能なので、実際に「連絡先に追加」を押した人だけに追加の同意を求める
let contactsTokenClient = null;

export function initContactsAuth(clientId, onToken, onError) {
  contactsTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/contacts',
    callback: (response) => {
      if (response.access_token) {
        onToken(response.access_token);
      } else if (onError) {
        onError(response);
      }
    },
  });
}

export function requestContactsLogin() {
  if (!contactsTokenClient) throw new Error('initContactsAuthが先に呼ばれていません');
  contactsTokenClient.requestAccessToken();
}
