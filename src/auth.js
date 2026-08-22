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
        onToken(response.access_token, response.expires_in);
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
// 期待通りに無操作で成功することもあるが、特にモバイルSafariでは
// prompt:''でもGoogleがサイレントに確定できず、アカウント選択画面が
// そのまま出てしまうことがある（既知の制約）。そのため呼び出し元では
// これを万能とせず、有効なトークンのキャッシュがある間はそもそも
// この関数を呼ばずに済ませる設計にしている（index.html参照）
export function requestSilentLogin() {
  if (!tokenClient) throw new Error('initGoogleAuthが先に呼ばれていません');
  tokenClient.requestAccessToken({ prompt: '' });
}
