# NEXUA名刺ポケット 合言葉発行のStripe買い切り決済化 設計

## 背景・目的

`docs/superpowers/specs/2026-08-22-meishi-bookmark-pin-auth-design.md`（合言葉方式＋買い切り課金の設計）は、段階1（PIN認証＋GAS backendへの同期、無料相当で一旦動かす）までしか実装されておらず、段階2（合言葉発行の前にStripe買い切り決済を挟む）が未着手のまま複数セッションが経過していた。現状の`issue_code`は`auth: 'none'`で誰でも無料・無制限に合言葉を発行できる状態。本ドキュメントは段階2の設計を確定する。

## 決定事項（ユーザーとの相談で確定）

- **価格**: ¥300（買い切り、1回きりの決済）
- **決済方式**: Stripe Payment Links（動的Checkout Session作成は行わない。NEXUA本体と同じ方式）
  - 決済リンク: `https://buy.stripe.com/cNi4gy6kE5KAgNm0gidby0b`（作成済み）
- **合言葉の受け渡し**: 決済完了後、専用の完了ページ(`payment-complete.html`)がポーリングで自動表示する（メール送信は行わない）
- **既存データ**: 移行対象なし。実装時にusersシートを全削除しヘッダー行のみにリセットする
- **既存の無料`issue_code`**: 廃止。合言葉発行の入口を決済後の`claim_code`のみに統一する

## 全体フロー

```
1. 一覧画面「合言葉を発行して他の端末とも同期する」
   → Stripe Payment Links(¥300・買い切り)へ遷移（同一タブ、`location.href`。localStorageの連続性のため新規タブではなく同一タブ遷移とした。実装が正）
2. 決済完了
   ├─ Stripe → GAS Webhook(?stripe_webhook=1, checkout.session.completed)
   │    → イベントID実在確認(Stripe API照会、署名検証の代替)
   │    → mode==='payment' かつ amount_total===300 を確認（不正リクエスト対策）
   │    → LockServiceで排他制御 → 合言葉を新規発行してusersシートに追加
   │    → CacheServiceに session_id → 合言葉 を一時保存(TTL 1時間)
   │    → CacheServiceにイベントIDを保存し冪等化(6時間、重複Webhook対策)
   └─ Stripe → ユーザーを payment-complete.html?session_id={CHECKOUT_SESSION_ID} へリダイレクト
        （Payment Links側の「決済後の遷移」設定を、この固定URLへのリダイレクトに変更する必要がある。
          Stripeダッシュボード側の手動設定であり、コードからは変更できない）
        → session_idをキーに action:'claim_code' をポーリング
        → 合言葉が用意でき次第、既存の「合言葉発行モーダル」と同じUIで表示・コピー機能を出す
```

## GAS backend側の変更（`gas-backend/Code.gs`）

### ルーティング

- `issue_code`アクションを削除する
- 新規: `claim_code`（`auth: 'none'`、`write: false`）— `session_id`を受け取り、キャッシュに合言葉があれば`{success:true, code}`、無ければ`{success:false, code:'PENDING'}`を返す
- `doPost`に、既存の`?stripe_webhook=1`分岐と同じパターンで、Webhook受信処理を追加

### Webhook処理（NEXUA本体`gas_backend.js`のパターンを踏襲）

- `checkStripeConnection`等と同様、`STRIPE_API_KEY`はスクリプトプロパティで管理（リポジトリに含めない）
- 受信イベントIDを`GET /v1/events/{id}`で実在確認（署名ヘッダーが読めないGASの制約への対処）
- 冪等化: `CacheService`にイベントIDを保存し、重複Webhookを無視
- `LockService.getScriptLock()`で排他制御してから合言葉発行・シート書き込み
- **買い切り固有の検証**: `session.mode === 'payment'`（`'subscription'`ではないこと）、`session.amount_total === 300`（想定外の金額での不正処理を防ぐ）を確認してから処理する
- Webhookレスポンスは`HtmlService.createHtmlOutput()`で返す（`ContentService`は302リダイレクトを挟みStripeのWebhook配信が失敗扱いになるため）
- **管理者通知**: イベント検証失敗・`handleCheckoutCompleted`失敗（＝決済は完了しているのに合言葉発行に失敗した場合）に、`MailApp.sendEmail()`でGAS実行アカウント自身（`Session.getEffectiveUser().getEmail()`）へ即座にメール通知する。Stripeの配信ログを能動的に見ない限り気づけない障害を、運営が放置しないための対策（2026-08-24の実機テストで実際に発生し、発覚まで数時間かかった経緯を踏まえて追加）。通知自体の失敗はログのみでWebhook応答は止めない

### レート制限

- `claim_code`はポーリングで頻繁に呼ばれる想定のため、既存の`checkRateLimit`（合言葉ごと）とは別に、session_idごとの緩やかな制限（例: 1分60回程度）を設ける

## フロントエンド側の変更

### `payment-complete.html`（新規ページ）

- URLの`session_id`クエリパラメータを読み取る
- 2秒間隔・最大30回（60秒）で`claim_code`をポーリング
- 合言葉が取得できたら、`index.html`の合言葉発行モーダルと同じUI（合言葉表示＋コピー用ボタン＋「ひかえました」ボタン）を出す。「ひかえました」を押したタイミングで`localStorage`に保存する設計は既存のPIN方式を踏襲する
- 60秒経っても取得できない場合: 「決済は完了していますが、合言葉の準備に時間がかかっています。少し時間を置いてこのページを再読み込みしてください」と案内する（自動復旧機能は作らない、既存の運用方針を踏襲）

### `index.html`

- 「合言葉を発行して他の端末とも同期する」ボタンの導線を、直接`issueCode()`を呼ぶのではなく、Stripe Payment LinksのURLへの遷移に変更する
- 「持っている合言葉を入力する」導線（既に合言葉を持っているユーザー用）は変更しない

## 非対象（YAGNI）

- 返金・キャンセル対応（デジタルコンテンツの性質上、原則返金なしとする。個別対応は運営が手動で判断）
- 領収書・インボイス対応（Stripe標準のレシートメールに委ねる）
- サブスクリプション化（将来必要になれば別途検討、当初の仕様書の記載を踏襲）
- 複数プラン・値引き（¥300の単一プランのみ）

## 変更履歴

- 2026-08-23: 初版作成。ユーザーとの相談で価格(¥300)・決済方式(Payment Links)・受け渡し方法(完了ページ自動表示)・既存データの扱い(全削除)を確定
- 2026-08-23: 実装計画(`docs/superpowers/plans/2026-08-23-meishi-bookmark-stripe-payment.md`)に基づき、Subagent-Driven Developmentでコード実装を完了。`gas-backend/Code.gs`にStripe API疎通ヘルパー・`claim_code`アクション・Webhook処理(冪等化・実在確認・ロック)を追加し`issue_code`を廃止、`gas-backend/backend.test.js`の全テストを新フローに合わせて書き換え。`src/pocketApi.js`の`claimCode()`追加・`issueCode()`削除。`index.html`のボタン導線をStripe Payment Linksへの遷移に変更し、`payment-complete.html`を新設。全てレビュー済み・GAS backend(clasp deploy @11)およびGitHub Pagesへのデプロイ済み。
  - **未実施（このコミット時点）**: 運用セットアップ(1) `STRIPE_API_KEY`のスクリプトプロパティ設定、(2) GASエディタでの`script.external_request`スコープ承認、(3) Stripeダッシュボードでの決済リンクの決済後リダイレクト設定、(4) StripeダッシュボードでのWebhookエンドポイント登録、(5) `users`シートのリセット、(6) 実機での実決済E2E確認。これらが完了するまで、コードは本番に存在するが決済フロー自体はまだ機能しない（`STRIPE_API_KEY`未設定のため`stripeApiGet`が例外を投げ、Webhookが失敗する）
- 2026-08-24: 運用セットアップ(1)〜(6)を全て完了し、実機で¥300決済〜合言葉受け取りまでのE2Eを確認。躓いた点と対処：
  - GASエディタへのブラウザアクセスが、実オーナーアカウント含め全アカウントで「アクセス権が必要です」となり続けた。原因は自動化ツール用の別ブラウザプロファインだったことで、ユーザーが普段使いの通常ブラウザで同じURLを開いたところ問題なくアクセスできた。
  - `script.external_request`スコープの承認は、GASエディタ上で該当スコープを使う関数を一度手動実行し、確認ダイアログを許可することでのみ可能（`clasp run`ではExecution API側の別の権限不足エラーとなり不可）。承認後は`clasp deploy`で新しいバージョンとして再デプロイしないと、既存のWebアプリデプロイには反映されない。
  - `STRIPE_API_KEY`の設定作業中、実際のAPIキーが会話に誤って露出する事故が発生。以降は「ユーザーが自分のターミナルで直接実行し、Claudeには値を見せない」運用に切り替えた。
  - 最終的に`STRIPE_API_KEY`の保存値の前後に全角括弧が混入するミスがあり、Stripe APIから「Invalid API Key」と判定されていた。原因特定には、保存値の文字コード・長さのみを返す一時診断エンドポイント（値そのものは返さない設計）を使用。
  - `STRIPE_API_KEY`設定・usersシートリセット等は、GASのWeb App（`ANYONE_ANONYMOUS`で既に公開デプロイ済み、Googleアカウント認証不要）にトークン保護付きの一時エンドポイントを都度追加し、使用後は毎回削除・gitにコミットせず本番から除去、という方式で実施した。
- 2026-08-25: GASプロジェクト（`meishi-bookmark-pocket-backend`）と紐づくスプレッドシート（「NEXUA名刺ポケット 合言葉データ」）のオーナーを、テストアカウント(`zz999999999@gmail.com`)から正式な管理者アカウント(`furetomojapan@gmail.com`)へGoogle Drive上で移譲。移譲後、GASエディタの「デプロイを管理」で既存Webアプリデプロイ（デプロイID不変・URL不変）を編集→再デプロイし、`executeAs: USER_DEPLOYING`の実行アカウントを更新。usersシートのテスト決済データも削除済み。実機で¥300決済〜合言葉発行までの一連のフローが新オーナー体制下で正常動作することを確認した。
- 2026-08-25: 本番サイトのURLをGitHub Pagesのデフォルト(`laxuz999.github.io/meishi-bookmark`)からカスタムドメイン(`pocket.nexua.tech`)に変更。リポジトリに`CNAME`ファイルを追加、ConoHaのDNSに`pocket`→`laxuz999.github.io`のCNAMEレコードを追加。GitHub Pages側の「Custom domain」設定は`CNAME`ファイルのpushだけでは自動反映されず、`gh api -X PUT repos/laxuz999/meishi-bookmark/pages -f cname=...`で明示的に設定して初めてSSL証明書の発行が始まった（この設定操作にはリポジトリのAdmin権限が必要で、ブラウザ経由の通常アカウントには権限がなかったため、ローカルのgh CLI認証で代替した）。同じくAPI経由で`https_enforced`も有効化。Stripe決済リンクの決済完了ページURLも新ドメインに更新済み。
