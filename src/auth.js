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
