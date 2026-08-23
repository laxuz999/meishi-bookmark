# NEXUA名刺ポケット 認証・同期の作り直し（合言葉方式＋買い切り課金）設計

正式名称: NEXUA名刺ポケット（リポジトリ名は `meishi-bookmark` のまま）

## 背景・経緯

初版（[2026-08-21-meishi-bookmark-design.md](./2026-08-21-meishi-bookmark-design.md)参照）は「運営(NEXUA)はデータを一切持たない」ことを最優先し、他端末との同期はお客様自身のGoogleアカウントとの直接連携（Google Identity Services）で実現していた。

しかし実際の運用検証で、この方式には構造的な問題があることが判明した。

- Googleの`prompt:''`によるサイレント再ログインは、モバイルSafari等で**サイレントに完結せず、Googleのアカウント選択画面を勝手に表示してしまう**ことがある（Google公式ドキュメントにも「一度リクエスト済みでも、アクセストークンの取得にはユーザー操作が必要」と明記されており、そもそも想定されていない使い方だった）
- アクセストークンをキャッシュして自動再ログインの頻度を下げる対策を打っても、キャッシュが切れれば同じ問題が再発し、根本解決にならなかった
- 「GAS Web Appを本人権限で実行する」代替方式も検証したが、テスト運用中のOAuthアプリ特有のアカウント権限管理（テストユーザー登録、Google Cloudプロジェクトの権限）で複数回行き詰まり、検証コストが見合わないと判断し中断した

加えて、そもそも「運営はNEXUA本体でも名刺データ・課金データをサーバー側で管理している」ため、「名刺ポケットだけは運営が一切データを持たない」という方針自体が、NEXUA全体で見ると一貫性を欠いていた。

これらを踏まえ、認証の主軸をGoogleログインからNEXUA本体と同じ「PIN方式」に切り替え、データの保存先も運営管理のGoogle Apps Script（GAS）＋スプレッドシートに変更する。あわせて、この機能（同期・バックアップ）を有料（買い切り）にする。

## 全体アーキテクチャ

```
[この端末にワンタップ保存]  ← 変更なし。認証不要・無料
        ↓（同期したい人だけ）
[Stripe決済（買い切り）]
        ↓
[GASが合言葉(8桁の英数字)を発行]
        ↓
[GAS Web App ⇄ 運営管理のスプレッドシート]
  - 実行者: 開発者権限（NEXUA本体のgas_backend.jsと同じパターン）
  - テキストデータ(url/name/tags/memo等)のみ保存
        ↓
[他の端末でも同じ合言葉を入力 → 同じデータが見える]

[紙の名刺登録・写真添付] ← 使う人だけ任意でGoogle連携（現行のGoogle Identity Services方式を維持）
  - 写真はユーザー自身のGoogle Driveに保存（運営は持たない）
```

## 段階的な実装（3段階）

1. **土台**: PIN認証＋GAS backend＋運営管理スプレッドシートへの同期（無料相当で一旦動かす）
2. **決済**: PIN（合言葉）発行の前にStripe買い切り決済を挟む
3. **写真機能の移行方針確定**: 紙の名刺登録・写真添付は現行のGoogle連携コードをほぼそのまま維持（保存先はユーザー自身のGoogle Drive）。土台（PIN認証）とは独立した機能として共存させる

このドキュメントは主に段階1・2を対象とする。段階3は現行仕様（[2026-08-21design.md](./2026-08-21-meishi-bookmark-design.md)の紙の名刺関連の記述）を踏襲し、認証の主軸がPINに変わったことに伴う接続点のみ後述する。

## 認証・合言葉まわり

- 合言葉は「使う人を識別するID」と「ログインの鍵」を兼ねる8桁の英数字（例: `A7K9QZ2M`）。名前・メールアドレスの入力は不要
- 初回発行: 決済完了後、GASが重複しないIDをランダム生成し、画面に表示する。ユーザーはこれを自分で控える（アプリ側では平文で二度と表示しない、または一覧画面に薄く常時表示しておく程度は検討の余地あり）
- ログイン: 「合言葉で同期する」ボタンから、8桁を入力するだけ。パスワード相当の追加情報は求めない（NEXUA本体のPINのような追加の暗証番号は今回は設けない。合言葉自体が十分にランダムであるため）
- 有効期限: ブラウザ側でセッショントークン的な概念は持たず、**合言葉自体を都度APIに渡して認証する**（GAS側は合言葉をキーにスプレッドシートの該当行を探す）。NEXUA本体のような期限付きセッション（sessionsシート）は今回は設けない（同期は低頻度操作のため、都度の合言葉入力で十分と判断。YAGNI）
- 合言葉を忘れた場合: 自動復旧機能は作らない。Stripeの決済記録（メールアドレス）を頼りに運営が個別対応する運用で当面様子を見る

## データの持ち方

### 運営管理スプレッドシート（新規、NEXUA本体とは別ファイル）

シート`users`（1行1合言葉）:

| 列 | 内容 |
|---|---|
| A: code | 合言葉(8桁) |
| B: createdAt | 発行日時 |
| C: stripeCustomerEmail | Stripe決済時のメールアドレス（復旧問い合わせ用） |
| D: bookmarksJson | この合言葉に紐づく名刺一覧をJSON文字列として1セルに保存 |

- 名刺一覧を行展開せず1セルのJSONにまとめる理由: 合言葉ごとの読み書きが1行の取得・更新で完結し、実装がシンプルになる（NEXUA本体のような複雑な行検索・行ロック管理が不要）。1ユーザーあたりの名刺数は数十〜百件程度を想定しており、JSON文字列がセル上限(5万文字)を超える心配は当面ない
- 将来件数が増えて上限に近づいた場合は行展開方式へ移行することを想定し、GAS側のAPIインターフェース（get_bookmarks/save_bookmarks）はスプレッドシートの内部構造を隠蔽する形にしておく

### GAS Web App API（案）

| action | 認証 | 内容 |
|---|---|---|
| `issue_code` | Stripe決済完了の検証 | 新しい合言葉を発行してusersシートに1行追加 |
| `get_bookmarks` | 合言葉 | その合言葉のbookmarksJsonを返す |
| `save_bookmarks` | 合言葉 | bookmarksJsonを丸ごと上書き保存（クライアント側で組み立てた最新の配列を渡す） |

- 実行者は開発者権限（`USER_DEPLOYING`、NEXUA本体のappsscript.jsonと同じ設定）。GAS Web AppのURLをクライアントJSから直接fetchする

## Stripe決済フロー

- 買い切り（サブスクではない）
- NEXUA本体は既にStripe Webhook連携の実績がある（`checkout.session.completed`を受けてplan列を更新するパターン）。これを参考に、名刺ポケット専用のStripe商品を1つ作り、Webhookで`issue_code`相当の処理を呼ぶ
- 詳細な決済導線（Stripe Checkoutのリダイレクト先、成功後の戻り方）は実装計画フェーズで詰める

## 廃止する既存コード

段階1・2の実装に伴い、以下は撤去する（Google連携の同期・バックアップ機能一式）。紙の名刺・写真機能（段階3）で使うコードは残す。

- `src/auth.js`（`initGoogleAuth`/`requestLogin`）… 段階3で写真機能用に一部を再利用する可能性があるため、削除は段階3の設計時に再検討
- `src/sheets.js`のfindSheet/createSheet/listBookmarks/appendBookmark/updateMemo/updateTags/deleteBookmark … ユーザー自身のGoogle Sheetsを直接操作するロジックは丸ごと不要になり、新しいGAS API呼び出しに置き換える
- index.html内のトークンキャッシュ(`meishi_google_token_cache`)・`GOOGLE_LINKED_KEY`まわりのロジック
- 「Googleでバックアップ・他の端末と同期する」ボタン・モーダル → 「合言葉で同期する」系のUIに置き換え

## 既存データの扱い

- これまでの検証で作成されたテストユーザーのGoogleスプレッドシート上のデータは移行しない（破棄してよい、と確認済み）
- 本番相当の既存利用者がいないため、後方互換は考慮しない

## エラーハンドリング

- 決済失敗・キャンセル: 合言葉は発行しない
- 合言葉の入力ミス: 「合言葉が見つかりません」と案内し、再入力を促す
- GAS API呼び出し失敗（ネットワークエラー等）: 既存の`describeGoogleSyncError`相当のエラー表示パターンを踏襲

## 非対象（YAGNI、今回のスコープ外）

- 合言葉の自動復旧（メール送信等）
- セッション・有効期限管理
- 月額サブスク化（将来必要になれば別途検討）
- 写真データの保存先の作り直し（段階3で現状維持のまま接続するのみ）

## 未決定・実装計画フェーズで詰める事項

- Stripe Checkoutの具体的な導線（商品作成、価格、成功/キャンセルページ）
- 合言葉表示後のUI（コピーしやすさ、再表示の可否）
- 既存のindex.html/src配下のどこまでを新規ファイルに切り出すか

## デプロイ済み情報

- GAS Web App URL: `https://script.google.com/macros/s/AKfycbyelJf8EEuEIWUiwrp2l8TFddL5jXemE-EKxDUeeJnQIxJpRsmPaaqh2eCHVLOXTEWj/exec`
- scriptId: `1agSPdYHeREX-gIXgpJ7D3qWIjFya1mXxwIeX6PW-KZTVkm0efRrtnT0y`（編集URL: `https://script.google.com/d/1agSPdYHeREX-gIXgpJ7D3qWIjFya1mXxwIeX6PW-KZTVkm0efRrtnT0y/edit`）
- スプレッドシート: standalone script（コンテナバインドなし）のため、GASプロジェクトの「概要」からは自動リンクされない。初回`issue_code`実行時に`SpreadsheetApp.create()`で新規作成され、そのIDがScript Properties（`PropertiesService`）の`SPREADSHEET_ID`に保存される方式（`getActiveSpreadsheet()`はstandalone scriptではnullになるため、コミット65c2f86でこの方式に修正済み）。スプレッドシートの実体を見るにはGoogle Drive上で「NEXUA名刺ポケット 合言葉データ」を検索するか、Script PropertiesのSPREADSHEET_IDからdriveで開く
- 疎通確認: 解決済み。匿名（未ログイン）ブラウザからのPOSTで`issue_code`→`{"success":true,"code":"VE552JJH"}`、`get_bookmarks`→`{"success":true,"bookmarks":[]}`を確認済み。GETでの`issue_code`は仕様どおり`{"success":false,"error":"GET非対応","code":"METHOD_NOT_ALLOWED"}`を返す（`write:true`のアクションはボット対策でGET非対応にしている、Code.gsのdoGet参照）

## 変更履歴

- 2026-08-22: 初版作成
- 2026-08-22: Task 2でGAS backendをclaspデプロイ。appsscript.jsonの`webapp.access`はTask 1の`"ANYONE"`だとログイン必須になることが判明したため`"ANYONE_ANONYMOUS"`に修正して確定。デプロイURLを記録（疎通確認は認可未完了によりブロック中）
- 2026-08-23: ユーザーが手動でOAuth権限承認を完了。別実装者によるCode.gsの`getSheet()`修正（standalone scriptでの`getActiveSpreadsheet()`null問題、コミット65c2f86）をpush・再デプロイ（同一デプロイURL、version @5）。匿名アクセスの疎通確認が成功し、問題は解消
- 2026-08-23: Task4の最終レビュー指摘を反映。合言葉入力は検証成功後にのみlocalStorageへ保存するよう変更（誤入力による既存合言葉の上書き消失を防止）。合言葉の再発行は既存合言葉がある場合に確認ダイアログを挟むよう変更。差分同期のマージ処理に`meishi_pocket_last_synced`（前回同期時刻）を導入し、他端末で削除した名刺がローカルの古いデータにより復活する不具合を修正。GAS backend側は`findUserRow`をA列のみ読むよう軽量化し、合言葉の生成を`Math.random()`から`Utilities.getUuid()`ベースに変更（詳細はtask-4-report.md参照）
- 2026-08-23: タイトル文言を「合言葉で同期中 - NEXUA名刺ポケット」から「S-NEXUA名刺ポケット」に短縮。合言葉発行モーダルにコピー用ボタンを追加。一覧画面の同期メニューに「この端末の同期を解除する」ボタンを追加（合言葉発行済みの場合のみ表示、確認ダイアログ後にlocalStorageの合言葉・最終同期時刻を消してローカルのみの状態に戻す）
- 2026-08-23: 「持っている合言葉を入力する」で別の合言葉に切り替える際も、発行時と同様に上書き確認ダイアログを挟むよう修正（従来はこの経路だけ無確認で切り替わっていた）。あわせて、同期処理の実行中（通信にかかる時間）に別タブ等で新規保存された名刺が次回以降ずっと同期対象から漏れるレースコンディションを修正（`meishi_pocket_last_synced`を同期「完了時」ではなく「開始時」のタイムスタンプで記録するように変更）
- 2026-08-23: 段階3（紙の名刺登録・写真添付）を復活。当初の想定通り、Google連携コードは同期機能とは完全に分離した新規ページ`paper-card.html`に隔離した。一覧画面(`index.html`)には合言葉で同期中の場合のみ「📇 紙の名刺を登録」リンクを表示し、クリックして初めて`paper-card.html`（および同ページ内でのみ読み込まれるGoogle連携用JS）が読み込まれる設計とし、通常の一覧閲覧時にはGoogle関連のコードが一切ロードされないようにした。`paper-card.html`は開いた時点ではGoogleと一切通信せず、「Googleと連携する」ボタンを押した時だけ`requestLogin()`を呼ぶ（自動サイレントログインは行わない、index.htmlの同期処理と同じ方針）。登録された表面・裏面写真はユーザー自身のGoogle Drive（既存の`src/drive.js`のuploadPhotoをそのまま再利用）に保存し、名前・タグ・メモ・写真URLは合言葉のGAS backend（`getBookmarks`→エントリ追加→`saveBookmarks`）に保存する。一覧画面の`renderCards`にも表裏写真のサムネイル表示を復活させた（合言葉で同期中の場合のみ）。メモへの写真添付機能（`memo-photo-btn`）は今回のスコープ外のまま
- 2026-08-23: 上記の実装後、ユーザーから「登録フォームだけでなく、登録済みの紙の名刺カード自体も一覧画面から分離してほしかった」との訂正指示。`index.html`の`renderCards()`から紙の名刺(`!b.url && b.frontPhotoUrl`)を完全に除外するフィルタを追加し、紙の名刺用のリンク分岐・表裏写真サムネイル表示ブロック・関連CSS(`.card-photos-row`等)を削除。`paper-card.html`側にその一覧表示・削除機能を統合した：ページを開いた時点（Google連携前）で`getBookmarks(code)`のみを呼び紙の名刺一覧を表示し、削除も`saveBookmarks`のみで完結させる（Google連携不要）。登録（写真アップロード）時のみ「＋新しく登録する」ボタン経由でGoogle連携を要求するモーダルを開く構成に変更。リンク文言も「📇 紙の名刺を登録」→「📇 紙の名刺」に変更（登録専用ではなくなったため）
- 2026-08-23: 実機確認で「編集機能がない」との指摘。一覧画面の通常カードと同じインライン編集UI（タグ・メモの「編集」ボタン→入力欄→保存/キャンセル）を`paper-card.html`の紙の名刺カードにも実装。編集もGoogle連携不要（`saveBookmarks`のみで完結）
- 2026-08-23: コードレビュー指摘を反映。(1)紙の名刺の削除/タグ編集/メモ編集が、ページ読み込み時点の古い一覧スナップショットから全体を上書き保存しており他端末の変更を消しうる問題を、保存直前に`getBookmarks()`で最新を取り直す方式(`saveWithRefetch`、`frontPhotoUrl`で対象特定)に修正。(2)「＋新しく登録する」を開くたびに有効なアクセストークンがあってもGoogle連携案内を毎回出していた問題を修正。(3)「紙の名刺」判定(`!url && frontPhotoUrl`)が`index.html`/`paper-card.html`に別々に重複していたのを`src/pocketApi.js`の`isPaperCard()`に共通化。(4)タグ/メモのインライン編集UIとalert/confirm代替ダイアログの実装(約150行)が両ページにコピペされていたのを`src/inlineEditor.js`(`renderEditableRow`)・`src/dialog.js`(`createAppDialog`)に共通化。あわせてこの2モジュールに対する自前DOMモックのユニットテストを追加(`src/testDom.js`)
- 2026-08-23: 改善提案を反映。(1)`paper-card.html`（紙の名刺一覧）に検索・並び替えを追加（`index.html`と同じ`src/render.js`の`filterAndSort`を再利用）。(2)GAS backend(`gas-backend/Code.gs`)に、`get_bookmarks`/`save_bookmarks`への合言葉ごとのレート制限を追加（`CacheService`で1分あたり30回まで、超過時は`RATE_LIMITED`エラー）。合言葉自体は32^8通りあり総当たりは非現実的だが、大量アクセスへの歯止めが無くGASの実行時間クォータ等を消費されるリスクへの対策。`issue_code`(auth:'none')は対象外（IPベースの制限はGAS Web AppがIPを直接取得する標準手段を持たないため未対応）。claspで既存デプロイ(`AKfycbyelJf8EEuEIWUiwrp2l8TFddL5jXemE-EKxDUeeJnQIxJpRsmPaaqh2eCHVLOXTEWj`)を更新（version @6）、本番環境で28回目以降が`RATE_LIMITED`になることを実機確認済み
- 2026-08-23: 追加の改善提案を反映。(1)about.htmlに、紙の名刺の写真URLが「リンクを知っている人は誰でも閲覧可」（`src/drive.js`の`uploadPhoto`が`role:'reader', type:'anyone'`で権限設定）である旨を明記（従来は「あなた自身のGoogleアカウントに保存される」としか書いておらず誤解を招く内容だった）。(2)一覧画面(`index.html`)に「💾 バックアップを書き出す（JSON）」ボタンを追加。合言葉が使えなくなった場合等の手動退避手段として、現在表示中の名刺データ(`allBookmarks`)をそのままJSONファイルとしてダウンロードする（`Blob`+`<a download>`）。インポート機能は無い（復元が必要な場合は運営に問い合わせる想定）。実機でダウンロード・JSON内容を確認済み
