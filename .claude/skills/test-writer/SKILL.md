---
name: test-writer
description: |
  テストの作成・追加・修正を求められたときに使う。
  テスト、テストトロフィー、統合テスト、結合テスト、E2Eテスト、
  ユニットテスト、テストカバレッジ、TDDに関する話題で必ず使うこと。
  「テストを書いて」「テストが足りない」「カバレッジを上げて」でも発動する。
---

## テストトロフィー原則

優先度: 統合テスト > E2Eテスト > ユニットテスト > 静的解析

ユニットテストは純粋関数・計算ロジック（優先度判定、追記判定、シフト時刻計算など）にのみ書く。
HTTPハンドラ・DB操作は統合テストでカバーする。

## Rust バックエンド (backend/)

テストファイルは各クレートの `tests/` に置く（統合テスト）。
`src/` 内の `#[cfg(test)] mod tests` は純粋関数のみ。

テスト用セットアップ:
- DynamoDB Local を使う（`docker run -p 8000:8000 amazon/dynamodb-local`）
- SDKクライアントは endpoint_url をローカルに向けて生成する
- テーブルはテスト開始時に作成し、テストごとに一意なテーブル名で分離する
- テスト用ヘルパー（クライアント生成・テーブル作成・シードデータ）は `tests/common/mod.rs` に集約する

Bedrock はトレイト経由で抽象化し、テストではフェイク実装（固定JSONを返す）に差し替える。
実Bedrockを呼ぶテストをCIに入れない。

統合テストでは axum の Router に対して `tower::ServiceExt::oneshot` でHTTPリクエストを投げ、
レスポンスとDynamoDBのアイテム状態の両方を検証する。

必ずテストすべき業務ルール:
- 未承認(draft)の記録がサマリ生成対象に含まれないこと
- `approved_at > summary.generated_at` の記録が「追記」と判定されること
- 母語入力時に original_text と lang が保存されること
- 旧 schema_version のアイテムが読めること（serde default）

## TypeScript フロントエンド (frontend/)

- Vitest を使用。Jest は使わない
- コンポーネントテストは React Testing Library
- API呼び出し層のテストは MSW (Mock Service Worker) でモック
- スナップショットテストは使わない

## インフラ (infra/)

- CDK は assertions モジュール（`Template.fromStack`）でスナップショットではなくプロパティを検証する
- 最低限: Lambda 2本 / DynamoDBテーブルとGSI / JWTオーソライザの存在を検証する

## 禁止事項

- テストを #[ignore] や skip にして通すこと
- アサーションを緩めてテストを通すこと（assert!(true) など）
- try/catch や .ok() でエラーを握りつぶすこと
- テストの中で sleep でタイミングに依存すること
- 実AWSリソース・実Bedrockに依存するテストをデフォルトのテストスイートに入れること
