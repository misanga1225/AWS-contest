# 介護施設向け 申し送り支援アプリ

介護現場のシフト交代時の「申し送り」を支援するWebアプリ

## 背景と課題

- 介護現場ではシフト交代時の申し送りが**残業の主因**となっている．日勤帯は複数職員が利用者を分担してケア・記録するが，夜勤者は1〜2名で全員を引き継ぐため，複数職員の記録を横断して把握する必要があり，口頭申し送りという定時外の拘束が生まれる
- 外国人職員は日本語の会話はできても**記録文書の作成が困難**な可能背がある

## 主な機能

1. **ケアメモの構造化** — 職員がテキストでケアメモを投稿すると，LLMが介護記録として構造化(利用者名、カテゴリ: 食事・水分・排泄・バイタル・インシデント・特記、正規化された日本語本文)し，職員が下書きを確認・修正して承認
2. **母語入力対応** — ベトナム語などの母語で入力しても，LLMが翻訳と構造化を同時に行い日本語の記録として保存（原文と言語コードも必ず保存）
3. **横断申し送りサマリ** — シフト終了時刻に，そのフロア・シフト帯の全職員の承認済み記録と各利用者の平常時情報から，次の勤務者向けに「要注意・変化あり・特記なし」の3段階優先度付きサマリを自動生成
4. **利用者マスタ管理** — 氏名・フロア・居室・baselineのCRUDと，デモデータの初期化ボタン

> **安全性の方針**: LLMには診断・治療・ケア方針の提案をさせず，記録の転記・要約・整形と「確認を促す」表現に限定．全記録は職員の承認を経てのみ確定．

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
| 設定・秘匿情報 | SSM Parameter Store / Secrets Manager |
| IaC | AWS CDK (TypeScript) + cargo-lambda-cdk |

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

## 動かし方(審査員の方向け)

**AWS上にデプロイして動作確認する構成**．カスタムドメインは使用せず，デプロイ後に発行される CloudFront のデフォルトドメイン(`https://xxxxxxxx.cloudfront.net`)でアクセス

### 前提条件

| ツール | バージョン目安 |
|---|---|
| AWSアカウント + AWS CLI v2 | 認証設定済み (`aws sts get-caller-identity` が通ること) |
| Node.js | 20以上 |
| Rust | stable (rustup) |
| cargo-lambda | `cargo install cargo-lambda` |
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

`cdk deploy` の中で Rust Lambda のクロスコンパイル(cargo-lambda-cdk)とフロントエンドのビルド・S3アップロードまで実行．完了時に以下が出力されます:

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
3. ケアメモを投稿 → LLMが構造化した下書きを確認・修正して**承認**
4. 言語をベトナム語(vi)に切り替えて母語で投稿 → 日本語記録として構造化されることを確認
5. サマリ画面で**手動生成**を実行(実運用ではシフト終了時刻に自動生成)
6. 3段階優先度のサマリから根拠記録へドリルダウン
7. サマリ生成後に別の記録を承認 → 「追記」枠に表示されることを確認

### 4. 後片付け

```bash
cd infra
npx cdk destroy
```

## ローカル開発

デプロイなしで開発する場合のコマンド(AWSクレデンシャルは必要):

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
npx tsc --noEmit                # 型チェック

# インフラ (infra/)
npx cdk synth                   # テンプレート検証
npx cdk diff                    # デプロイ済みスタックとの差分
```

## 制約・注意事項

- デモは架空データのみを使用
- LLMの出力は必ず職員の承認を経て確定する
- サービス間認証はすべてIAMロールで行い，APIキーは使用しない
