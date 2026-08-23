# NEXUA名刺ポケット

NEXUAの名刺URLを保存して一覧で見返せるツール。紙の名刺を写真で登録することもできる。

- 本番サイト: https://laxuz999.github.io/meishi-bookmark/
- **基本**: 「保存」を押すと認証なしでその端末のブラウザ内（localStorage）に即保存。1タップで完結し、誰でもすぐ使える
- **オプション（合言葉方式）**: 一覧画面の「合言葉を発行して他の端末とも同期する」から、新しく8桁の合言葉を発行するか、既に持っている合言葉を入力すると、他の端末とも同じ名刺一覧を共有できる。合言葉を発行すると、名刺のテキスト情報（名前・URL・タグ・メモ）はNEXUA運営が管理するサーバー（`gas-backend/`、GAS Web App + スプレッドシート）に保存される。仕組みの詳細は`docs/superpowers/specs/2026-08-22-meishi-bookmark-pin-auth-design.md`を参照
- **S-NEXUA 撮影名刺**（`paper-card.html`、紙の名刺を写真で登録する機能）: 合言葉を発行している場合のみ、一覧画面の「📇 S-NEXUA 撮影名刺」から利用可能。名前・タグ・メモに加えて表面・裏面の写真を撮影・登録できる。一覧表示・検索・タグメモの編集・削除もこのページで完結する。写真はユーザー自身のGoogleアカウント（Google Drive、`drive.file`スコープ）に保存され、バックエンドにはその写真へのリンクだけが保存される（リンクは「知っている人は誰でも閲覧可」の設定になる）
- **バックアップ**: 一覧画面の「💾 バックアップを書き出す（JSON）」から、現在表示中の名刺データをJSONファイルとしてダウンロードできる（インポート機能は無い）

### 注意: iPhoneでホーム画面に追加する場合

iOS（Safari/Chrome）でこのページをホーム画面に追加する手順:

1. 画面下部（または上部）の共有ボタン（四角に↑のアイコン）をタップ
2. 「ホーム画面に追加」を選択
3. 追加ダイアログに出る**「Webアプリとして開く」はオフ**にする
4. 「追加」をタップ

オンのままだと、ホーム画面のアイコンから開いたときと通常のタブから開いたときで別々のブラウザストレージ（localStorage）が使われ、保存したはずの名刺が「消えた」ように見える（実際には元のタブ側には残っている）。オフにすれば通常のタブと同じストレージを共有する。この案内は保存完了画面と一覧画面の両方に表示している。

## 開発

静的サイトなのでビルド不要。`index.html`を直接開くか、`npx serve`等でローカル確認。

## テスト

```
npm test
```

（`node --test src/` はこの環境のNode.jsバージョンではディレクトリ指定が動作しないため、`npm test`＝`node --test 'src/**/*.test.js' 'gas-backend/**/*.test.js'` を使う。GAS backendのテストはNode.js上のvmモジュールでGASのAPIを最小モックして実行している）

## 同期バックエンド（GAS Web App）のデプロイ

合言葉方式の同期は `gas-backend/Code.gs` をGoogle Apps Script（standalone script、コンテナバインドなし）としてデプロイして使う。ログイン・OAuth同意画面は不要（匿名アクセス）。

1. `gas-backend/`配下を[clasp](https://github.com/google/clasp)でpush
2. `gas-backend/appsscript.json`の`webapp.access`は`"ANYONE_ANONYMOUS"`にする（`"ANYONE"`だとログイン必須になり匿名アクセスできない）
3. Webアプリとしてデプロイ（実行ユーザー: 自分、アクセスできるユーザー: 全員）
4. 発行されたデプロイURLを `src/pocketApi.js` の `API_URL` に設定
5. 初回`issue_code`実行時、データ保存用のスプレッドシート（「NEXUA名刺ポケット 合言葉データ」）が`SpreadsheetApp.create()`で自動作成される。そのIDはScript Properties（`PropertiesService`）の`SPREADSHEET_ID`に保存される

スプレッドシートに保存されるのは名刺のテキスト情報（url/name/tags/memo）と、紙の名刺の写真URL（frontPhotoUrl/backPhotoUrl、Google Drive上のリンク）。写真の実体はGAS backend側には一切送られず、常にユーザー自身のGoogleアカウントに直接アップロードされる。

`get_bookmarks`/`save_bookmarks`は合言葉ごとに1分あたり30回までのレート制限がある（`CacheService`、超過時は`RATE_LIMITED`エラー）。

設計の経緯・詳細は`docs/superpowers/specs/2026-08-22-meishi-bookmark-pin-auth-design.md`を参照。
