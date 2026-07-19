# 介護施設向け 申し送り支援アプリ

介護現場のシフト交代時の「申し送り」を支援するWebアプリ

## 背景と課題

- 介護現場ではシフト交代時の申し送りが**残業の主要因**となっている．日勤帯は複数職員が利用者を分担してケア・記録するが，夜勤者は1〜2名で全員を引き継ぐため，複数職員の記録を横断して把握する必要があり，口頭申し送りという定時外の拘束が生まれる
- 外国人職員は日本語の会話はできても**記録文書の作成が困難**な可能性がある

## 主な機能

1. **ケアメモの構造化** — 職員がテキストでケアメモを投稿すると，LLMが介護記録として構造化(利用者名，カテゴリ: 食事・水分・排泄・バイタル・インシデント・特記，正規化された日本語本文)し，職員が下書きを確認・修正して承認
2. **母語入力対応** — 他言語で入力しても，LLMが翻訳と構造化を同時に行い日本語の記録として保存（原文と言語コードも必ず保存）
3. **横断申し送りサマリ** — シフト終了時刻に，そのフロア・シフト帯の全職員の承認済み記録と各利用者の平常時情報から，次の勤務者向けに「要注意・変化あり・特記なし」の3段階優先度付きサマリを自動生成

> **安全性の方針**: LLMには診断・治療・ケア方針の提案をさせず，記録の転記・要約・整形と「確認を促す」表現に限定．全記録は職員の承認を経てのみ確定

## システムアーキテクチャ

![システムアーキテクチャ](docs/AWS_contest.png)

| レイヤ | 構成 |
|---|---|
| フロントエンド | Vite + React + TypeScript SPA / S3 + CloudFront配信 |
| 認証 | Amazon Cognito (JWT) |
| API | API Gateway HTTP API + JWTオーソライザ |
| バックエンド | Rust Lambda ×2 (provided.al2023 / arm64 / lambda_http + axum) |
| LLM | Amazon Bedrock (Claude) — 構造化・翻訳・要約 |
| DB | DynamoDB 単一テーブル　|
| スケジュール | EventBridge Scheduler (サマリ生成) |
| 設定値 | SSM Parameter Store（秘匿情報は保持せず、サービス間はIAMロール認証） |
| IaC | AWS CDK (TypeScript) + cargo-lambda-cdk |

## アピールポイント

### 「横断要約 × 優先度付け」と「多言語対応」

- **職員横断の申し送りを一覧化し，重要度で優先度付け** — 日勤帯に複数職員が別々に残した承認済み記録を，シフト終了時にフロア単位で1つのサマリに統合．「要注意 / 変化あり / 特記なし」の3段階優先度を付けて表示するため，引継ぎ者は膨大な記録を1件ずつ追わずに，**まず見るべき利用者から把握**できる
- **AIは「判断」しない** — 優先度付けは診断ではなく，記録の内容を要約・整理して職員の確認を促すもの．診断・治療・ケア方針の提案はさせず，全記録は職員の承認を経てのみ確定する
- **母語入力の翻訳と構造化を同時実行** — 他言語で入力しても日本語の介護記録として保存でき，外国人職員の「記録文書作成の壁」を取り除く

### 技術・設計

- **記録の作成者・承認者を証跡として保持** — 各記録に作成者・承認者を Cognito のユーザーIDで焼き込み，「誰がいつ書き，誰が承認したか」を追跡．承認済み記録は物理削除・上書きを禁止し，訂正は新規記録として追加するため，記録の改ざん耐性と説明責任を担保
- **Rust製Lambdaで低コールドスタート** — バックエンドを Rust（provided.al2023 / arm64）で実装．軽量ネイティブバイナリのためコールドスタートが短い
- **S3 + CloudFront によるエッジ配信** — フロントエンドSPAを S3 に置き CloudFront でキャッシュ配信するため，エッジから高速に初期表示できる．VPC・サーバー常駐なしのフルサーバレス構成で，運用負荷とアイドルコストを最小化
- **DynamoDB単一テーブル設計** — フロア単位のキー設計と時系列ソートキーにより，申し送りに必要な「直近シフト分の記録」を蓄積量に依存しない一定コストのクエリで取得

## リポジトリ構成

```
backend/    Rust cargoワークスペース
  domain/      共有型 (CareRecord, Resident, HandoverSummary)
  api/         API Lambda (全RESTルート)
  summarizer/  要約Lambda (シフト終了トリガ + 手動トリガ)
frontend/   Vite + React + TypeScript SPA
infra/      CDK (TypeScript)
docs/       アーキテクチャ図など
```

## 動かし方

**AWS上にデプロイして動作確認する構成**．カスタムドメインは使用せず，デプロイ後に発行される CloudFront のデフォルトドメインでアクセス

### 前提条件

| ツール | バージョン目安 |
|---|---|
| AWSアカウント + AWS CLI v2 | 認証設定済み (`aws sts get-caller-identity` が通ること) |
| Node.js | 20以上 |
| Rust | stable (rustup) |
| cargo-lambda | `pip install cargo-lambda` / `brew install cargo-lambda` / `scoop install cargo-lambda` ([公式手順](https://www.cargo-lambda.info/guide/installation.html)) |
| AWS CDK | `npm install -g aws-cdk` (またはnpx使用) |

**Bedrockモデルアクセスの有効化**: デプロイ先リージョン(既定: `ap-northeast-1`)のBedrockコンソール →「モデルアクセス」で **Anthropic Claude** を有効化

### 1. デプロイ

```bash
git clone <このリポジトリ>
cd aws_contest

# フロントエンドの依存関係をインストール（cdk deploy時のビルドに必要）
cd frontend
npm install
cd ..

# デプロイ
cd infra
npm install
npx cdk bootstrap          # 対象アカウント/リージョンで初回のみ
npx cdk deploy
```

`cdk deploy` の中で Rust Lambda のクロスコンパイル(cargo-lambda-cdk)とフロントエンドのビルド・S3アップロードまで実行．完了時に以下が出力:

- `CloudFrontUrl` — アプリのURL
- `UserPoolId` / `UserPoolClientId` — Cognito情報
- `ApiEndpoint` — API Gateway URL

### 2. デモユーザーの作成

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username demo-staff \
  --temporary-password 'TempPass123!' \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id <UserPoolId> \
  --username demo-staff \
  --password '<任意のパスワード>' \
  --permanent
```

### 3. 動作確認フロー

1. `CloudFrontUrl` をブラウザで開き，作成したユーザでログイン
2. 利用者マスタ画面で**「デモデータ初期化」**ボタンを押す(架空の利用者・baselineが投入されます)
3. ケアメモを投稿 → LLMが構造化した下書きを確認・修正して承認
4. 言語を多言語に切り替えて母語で投稿 → 日本語記録として構造化されることを確認
5. サマリ画面で手動生成を実行(実運用ではシフト終了時刻に自動生成)
6. 3段階優先度のサマリから根拠記録へドリルダウン
7. サマリ生成後に別の記録を承認 → 「追記」枠に表示されることを確認

### 4. 後片付け

```bash
cd infra
npx cdk destroy
```

## ローカル開発

デプロイなしで開発する場合:

```bash
# バックエンド (backend/)
cargo build
cargo test                      # 統合テスト (DynamoDB Local: docker run -p 8000:8000 amazon/dynamodb-local)
cargo clippy -- -D warnings
cargo lambda watch              # Lambdaローカル起動

# フロントエンド (frontend/)
npm install                     # 初回のみ
npm run dev                     # 開発サーバー (.env にAPI URL / Cognito設定が必要)
npx vitest run                  # テスト
npx tsc -b                      # 型チェック

# インフラ (infra/)
npx cdk synth                   # テンプレート検証
npx cdk diff                    # デプロイ済みスタックとの差分
```
