# 名刺ブックマーク

NEXUAの名刺URLを、自分のGoogle Driveに保存して一覧で見返せるツール。

- 本番サイト: (デプロイ後に記入)
- データはお客様自身のGoogle Drive内「NEXUAブックマーク」シートに保存され、運営側は一切保持しません

## 開発

静的サイトなのでビルド不要。`index.html`を直接開くか、`npx serve`等でローカル確認。

## テスト

```
node --test src/
```

## OAuthクライアントIDの設定

1. Google Cloud Consoleで新規プロジェクトを作成
2. 「APIとサービス」→「認証情報」→「OAuthクライアントIDを作成」（種類: ウェブアプリケーション）
3. 「承認済みのJavaScript生成元」に本番URLを追加
4. 「APIとサービス」→「ライブラリ」で Google Sheets API と Google Drive API を有効化
5. 発行されたクライアントIDを `index.html` 内の `GOOGLE_CLIENT_ID` に設定
