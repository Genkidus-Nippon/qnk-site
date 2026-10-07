# QnK：フォルダー不要・ファイル単体版

Supabaseを使わず、質問・回答・資料リンクをGitHubの非公開リポジトリに保存する版です。利用者はRenderのURLから質問を送り、公開された回答を読めます。GitHubアカウントは利用者には不要です。

コードと保存データはGitHub、Webページの配信と運営者認証はRenderが担当します。GitHub Pagesは静的サイトのため、この版のサーバー処理は動かせません。[GitHub Pages公式説明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

## 1. GitHubに2つのリポジトリを用意

1. コード用リポジトリ（例：`qnk-site`）を作成します。
2. 今回お渡しした21個のファイルをすべてダウンロードし、GitHubの **Add file → Upload files** でまとめてアップロードします。フォルダーを作らず、すべてリポジトリの一番上に置いてください。前の版を使っている場合は今回のファイルで置き換えます。
3. データ用リポジトリ（例：`qnk-data`）を別に作成します。必ず**Private**を選び、**Add a README file**を有効にします。標準のブランチ名は`main`です。

質問の保存で自動コミットが発生するため、Renderはコード用リポジトリだけに接続してください。データ用リポジトリには接続しません。データ用を公開すると、質問者名・未公開の質問・過去の履歴も公開されます。保存処理は非公開であることを確認してから動作します。

## 2. データ保存用のGitHubトークンを作成

GitHubのプロフィールから **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token** を開きます。

|項目|設定|
|---|---|
|Resource owner|データ用リポジトリを所有するアカウント|
|Expiration|運用終了日（2026年11月9日）より後|
|Repository access|Only select repositories → データ用の`qnk-data`だけ|
|Repository permissions → Contents|Read and write|
|Metadata|自動で付与されるReadのみ|

組織のリポジトリの場合、組織側の承認が必要になることがあります。トークンは次のRenderの`GITHUB_TOKEN`に入力します。トークンをコードやブラウザー用の設定に書かないでください。[トークン公式手順](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[Contents APIの必要権限](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)

## 3. RenderにWeb Serviceを作成

**New → Web Service** でコード用リポジトリ（`qnk-site`）を選びます。これまでStatic Siteを使っていた場合、この版ではWeb Serviceを新しく作成してください。

|Renderの項目|値|
|---|---|
|Language / Runtime|Node|
|Branch|main|
|Root Directory|空欄（全ファイルを同じ階層にアップロード）|
|Build Command|`npm install --include=dev && npm run build`|
|Start Command|`npm start`|
|Health Check Path|`/healthz`|
|Persistent Disk|不要|

Node.js 22.13以上が必要です。Renderの標準Node環境で動作します。もし古いバージョンを指定している場合は、その指定を解除するか対応版に更新してください。

Freeプランは、アクセスがしばらくないと休止し、再アクセス時に起動を待つ場合があります。データはGitHubに保存するので、Renderの再起動で消えません。[Render Web Service](https://render.com/docs/web-services)、[Freeプランの制約](https://render.com/docs/free)

## 4. RenderのEnvironmentに入力

|Key|Value|
|---|---|
|`ADMIN_EMAIL`|`kihara.hiroto@aiesec.jp`|
|`ADMIN_PASSWORD`|QnK専用のパスワードを自分で決める（12文字以上）|
|`SESSION_SECRET`|推測できないランダム文字列（32文字以上）|
|`GITHUB_TOKEN`|手順2で作成したトークン|
|`GITHUB_OWNER`|データ用リポジトリの所有者名（GitHubのユーザー名または組織名）|
|`GITHUB_REPO`|データ用リポジトリ名（例：`qnk-data`。URLや`.git`は付けない）|
|`NODE_ENV`|`production`|

`SESSION_SECRET`は、例えば手元のNode.jsで次のコマンドを実行して生成できます。表示された値をRenderだけに設定してください。

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

運営者ログインで使うのは`ADMIN_EMAIL`と`ADMIN_PASSWORD`です。GitHubやChatGPTのアカウントのパスワードを入力する仕組みではありません。

次の値は通常、設定不要です。

|任意のKey|用途・既定値|
|---|---|
|`GITHUB_BRANCH`|保存先ブランチ。既定値`main`|
|`GITHUB_DATA_PATH`|保存ファイル。既定値`qnk/data.json`|
|`APP_URL`|独自ドメインを使う場合の公開URL。例：`https://qnk.example.com`|
|`PORT`|Renderが自動設定するため手動入力不要|

通常の`onrender.com`公開URLはRenderが設定する`RENDER_EXTERNAL_URL`から自動取得します。独自ドメインの場合は`APP_URL`をそのURLに設定し、そのドメインからアクセスしてください。[Renderの自動環境変数](https://render.com/docs/environment-variables)、[環境変数の設定](https://render.com/docs/configure-environment-variables)

## 5. 公開後の確認

1. Renderに表示される`https://…onrender.com`を開きます。
2. 質問を1件送信し、データ用リポジトリに`qnk/data.json`が自動作成されること（手動でフォルダーを作る必要はありません）を確認します。
3. サイト右上の三点メニューから「運営者ページ」を開き、設定したメール・パスワードでログインします。
4. 質問と並んだ回答欄に入力して公開し、「回答一覧」に反映されることを確認します。
5. ログアウトした状態で運営者の質問一覧が開けないことも確認してください。

Supabaseで既に実際の質問・回答を受け付けていた場合、この版へ自動移行はしません。新しいGitHub保存先には空の状態から蓄積されます。

## 日時と運営

- 2026年10月20日12:00（日本時間）：第二版へ切り替え
- 2026年11月3日12:00（日本時間）：第三版へ切り替え
- 2026年11月9日0:00（日本時間）：利用者のボタンをなくし、「清き一票をありがとう」に切り替え。質問受付も停止

切り替え日時は`config.mjs`に固定しています。運営者画面から変更できません。第一版のURLは設定済みです。第二版・第三版のURLは運営者ページの「資料リンク」で設定します。

Webからの質問だけをICX・OGX・各学年別に集計します。「別媒体の質問を掲載」から追加したQ&Aは集計に含めません。公開APIは質問者名・所属・学年を返しません。回答公開前に、本文に個人情報が残っていないか運営者が確認してください。

ログインは12時間で期限切れになります。Renderで`ADMIN_PASSWORD`または`SESSION_SECRET`を変更して再デプロイすると、以前のログインは無効になります。質問や回答はGitHubのコミット履歴にも残ります。データの削除が必要な場合は履歴も含めて対応が必要です。

この構成は少人数の運営向けです。GitHub APIの利用制限に合わせ、1台のサーバーで保存操作を毎分30回・毎時300回までに制限しています。集中時は送信エラーを表示し、再試行を案内します。利用規模が増える場合はデータベースへの移行が必要です。[GitHub APIの利用制限](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

## ファイルと確認

全ファイルをGitHubの一番上に同じ階層でアップロードしてください。

|ファイル|役割|
|---|---|
|`index.html`|ページの入口|
|`style.css`|デザイン|
|`app.js`|生成済みの画面プログラム|
|`favicon.svg`|ブラウザー用アイコン|
|`server.mjs`|サーバー起動・環境変数|
|`api.mjs`|質問受付・集計・運営者認証・回答公開|
|`github-store.mjs`|GitHubの非公開リポジトリへの保存|
|`config.mjs`|固定日時・質問の種類・初期資料URL|
|`package.json`|Renderの起動・ビルド設定|
|`build.mjs`|画面のビルド|
|`tsconfig.json`|TypeScriptの設定|
|`QnK.tsx`|画面の編集用ソース|
|`auth.tsx`|ログイン画面の編集用ソース|
|`main.tsx`|画面の起動用ソース|
|`services.ts`|画面とサーバーの通信|
|`config.ts`|画面で共有設定を読み込むソース|
|`app.test.mjs`|認証・受付・回答・日時のテスト|
|`github-store.test.mjs`|保存処理のテスト|
|`fake-github.mjs`|テスト専用の模擬GitHub|
|`.gitignore`|パスワードなどをGitHubに入れない設定|
|`README.md`|この設定手順|

```sh
npm install --include=dev
npm run build
npm run check
npm test
```

納品時には画面のビルドと模擬GitHub APIでの動作確認を行っています。実際のGitHubトークン・リポジトリ・Renderでの公開は未設定です。
