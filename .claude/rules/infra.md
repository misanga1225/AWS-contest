---
paths:
  - infra/**
---

- IaC は CDK (TypeScript)。Rust Lambda のビルドは cargo-lambda-cdk（RustFunction）で統合する
- Lambda は provided.al2023 / arm64。api と summarizer の2本のみ
- VPC は使わない。VPC・NAT Gateway・RDS 等を追加するコードを書かない
- サービス間認証はすべて IAM ロール。APIキー・シークレット文字列での認証を実装しない
- IAM は最小権限。`*` リソースやワイルドカードアクションを避け、テーブルARN・モデルARN単位で絞る
- 設定値は SSM Parameter Store（標準ティア＝無料）。CDKコード内に値をハードコードしない
- Secrets Manager は使わない（月額課金が発生するため）。秘匿情報を保存する設計にせず、サービス間はIAMロール認証で完結させる
- CloudFront + S3 は OAC (Origin Access Control) で接続。S3バケットの公開設定は禁止
- API Gateway は HTTP API + Cognito JWTオーソライザ。オーソライザなしのルートを作らない（ヘルスチェックを除く）
- EventBridge Scheduler のシフト終了スケジュールはSSMのシフト定義と整合させる
- DynamoDB テーブルは RemovalPolicy を明示する（ハッカソン中は DESTROY で可、コメントで明記）
- `cdk deploy` / `cdk destroy` はユーザーの確認を取ってから実行する
- スタック変更後は `npx cdk synth` が通ることを確認する
