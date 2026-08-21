let tokenClient = null;

export function initGoogleAuth(clientId, onToken, onError) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
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
