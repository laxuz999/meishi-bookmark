# 名刺ブックマーク

NEXUAの名刺URLを、自分のGoogle Driveに保存して一覧で見返せるツール。

- 本番サイト: https://laxuz999.github.io/meishi-bookmark/
- データはお客様自身のGoogle Drive内「NEXUAブックマーク」シートに保存され、運営側は一切保持しません

## 開発

静的サイトなのでビルド不要。`index.html`を直接開くか、`npx serve`等でローカル確認。

## テスト

```
npm test
```

（`node --test src/` はこの環境のNode.jsバージョンではディレクトリ指定が動作しないため、`npm test`＝`node --test src/**/*.test.js` を使う）

## OAuthクライアントIDの設定

1. Google Cloud Consoleで新規プロジェクトを作成
2. 「APIとサービス」→「ライブラリ」で Google Sheets API と Google Drive API を有効化
3. 「APIとサービス」→「OAuth同意画面」を設定
   - User Type: 外部
   - スコープは追加不要（`drive.file` は非機密スコープのためスコープ登録画面での明示追加は不要）
   - **本番公開するまでは「テスト」ステータスのまま**で、「対象」→「テストユーザー」に使う人のGoogleアカウントを登録しておく（登録した人しかログインできない）
4. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuthクライアントID」（種類: ウェブアプリケーション）
5. 「承認済みのJavaScript生成元」に本番URLのオリジン（例: `https://laxuz999.github.io`）を追加
6. 発行されたクライアントIDを `index.html` 内の `GOOGLE_CLIENT_ID` に設定

### 使用スコープ

`https://www.googleapis.com/auth/drive.file`（このアプリが作成/開いたファイルにのみアクセス、非機密スコープ）のみを使用。ユーザーの他のGoogle Driveファイルにはアクセスしない。

### 本番公開（テスト制限の解除）について

「テスト」ステータスのままだと、テストユーザーとして登録した人しかログインできない（上限100人）。NEXUAアカウントを持たない一般の人にも使ってもらうには、OAuth同意画面を「本番環境に公開」する必要がある。使用スコープが `drive.file`（非機密）のみであれば、Googleの審査なしで公開できる見込み。
