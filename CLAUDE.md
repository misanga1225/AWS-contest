# Project

「AIヘルパー わびすけ」— 介護施設向け申し送り支援Webアプリ（AWSハッカソン）。
※アプリ名の「AI」は「ラブ」と読む。日本語UIではヘッダー・ログイン画面でルビを振る（`components/AppName.tsx`）。
フルサーバレス構成（VPCなし）: CloudFront + S3 / Cognito / API Gateway HTTP API (JWTオーソライザ) / Rust Lambda×2 (provided.al2023, arm64) / Amazon Bedrock (Claude) / DynamoDB単一テーブル / EventBridge Scheduler / SSM Parameter Store（設定値）。秘匿情報の保存は行わず、サービス間はIAMロール認証（Secrets Managerは使わない＝月額課金回避）。
アーキテクチャ図: docs/AWS_contest.png

## ディレクトリ構成

- `backend/` — cargoワークスペース（3クレート）
  - `domain` — serde共有型（CareRecord, Resident, HandoverSummary）。schema_version + serde default で前方互換
  - `api` — API Lambda（lambda_http + axum。記録の投稿・承認・一覧、利用者CRUD、サマリ取得の全RESTルート集約）
  - `summarizer` — 要約Lambda（EventBridge Schedulerのシフト終了トリガ + 手動トリガ）
- `frontend/` — Vite + React + TypeScript SPA（React Router, TanStack Query, Tailwind CSS v4, react-hook-form + zod, react-i18next (ja/en/vi), aws-amplify v6 は Auth モジュールのみ）
  - UIは shadcn/ui を導入せず `components/ui.tsx` に自前のプリミティブを置く（依存を増やさないため）
  - デザインはApple HIG準拠。色・角丸・タイポ・イージングは `src/index.css` の `@theme` セマンティックトークン経由でのみ参照する。詳細は `docs/design.md`
- `infra/` — CDK (TypeScript) + cargo-lambda-cdk

## コマンド

### バックエンド (backend/)
- `cargo build` — ビルド
- `cargo test` — テスト（統合テスト中心）
- `cargo clippy -- -D warnings` — lint
- `cargo fmt --check` — フォーマットチェック
- `cargo lambda watch` — Lambdaローカル起動（動作確認用）

### フロントエンド (frontend/)
- `npm run dev` — 開発サーバー
- `npm run build` — プロダクションビルド
- `npx vitest run` — テスト
- `npm run lint` — ESLint
- `npx tsc -b` — 型チェック（project references構成のため `--noEmit` ではなく `-b` を使う）

### インフラ (infra/)
- `npx cdk synth` — テンプレート合成（検証を兼ねる）
- `npx cdk diff` — デプロイ済みスタックとの差分
- `npx cdk deploy` — デプロイ（必ずユーザーの確認を取ってから実行）
- `npx tsc --noEmit` — 型チェック

### DB (DynamoDB)
- テーブル・GSI定義は infra/ のCDKでのみ管理。コンソールやCLIでの手動変更は禁止
- キー設計: PK=`FLOOR#{floor}`、SK=`RECORD#{timestamp}#{id}` / `RESIDENT#{id}` / `SUMMARY#{date}#{shift}`、利用者別時系列のGSIを1本
- スキーマ進化は domain クレートの schema_version + `#[serde(default)]` で対応。既存属性のリネーム・型変更は禁止
- 詳細は .claude/rules/db.md を参照

## 規約
- Rustのエラー処理は thiserror + anyhow。panic!は禁止
- DynamoDBアクセスは serde_dynamo で domain 型と相互変換する。アイテムを手組みで構築しない
- Query + begins_with で取得する。Scan はデモデータ初期化を除き禁止
- LLM (Bedrock) には診断・治療・ケア方針の提案をさせない。記録の転記・要約・整形と「確認を促す」表現に限定する
- LLM に「誰の記録か」を判定させない。対象利用者は職員が画面で必ず選ぶ（同定推論は転記・整形の範囲外。自動入力された氏名は承認を形骸化させ、取り違えが確認をすり抜ける）。構造化プロンプトに利用者の氏名を渡さない
- LLM出力は下書き(draft)として保存し、職員の承認(approved)を経てのみ確定扱いとする
- 母語入力の原文 (original_text) と言語コード (lang) は必ず保存する
- 利用者の削除は論理削除（退所 = `status: discharged`）。ケア記録に法定保存義務があるため。記録が1件も無い場合のみ物理削除する。詳細は .claude/rules/db.md
- 設定値（シフト時刻・テーブル名等）はSSM Parameter Store。ハードコード禁止
- フロントエンドの型は `any` 禁止。API応答には必ず型を定義する
- UIの色は `src/index.css` の `@theme` セマンティックトークン経由で参照する。`slate-*` `sky-*` 等のTailwindデフォルトパレット直書きは禁止（docs/design.md）
- `focus:outline-none` の単独指定は禁止。必ず `focus-visible` リングを伴わせる
- テストトロフィー: ユニットテストよりも統合テストを優先する

## 禁止事項
- テスト削除・アサーション弱体化で通すことは絶対に禁止
- unwrap() をプロダクションコードで使わない（テストコードでは可）
- .env・AWSクレデンシャル・Cognito設定値をgitに含めない
- `cdk destroy`・`aws dynamodb delete-table` 等の破壊的操作をユーザー確認なしで実行しない
- 利用者の個人情報（氏名等）をログに出力しない
- チェック出力なしで「完了」と報告することを禁止する

## ループ協議
1. 変更を書く
2. バックエンド → `cargo test` + `cargo clippy` / フロントエンド → `vitest` + `tsc` / インフラ → `npx tsc --noEmit` + `npx cdk synth`
3. 失敗 → エラーを読み、修正して 2 へ戻る
4. 同じエラーが2回連続 → @fixer を呼ぶ
5. 全チェック通過後、@reviewer に差分レビューを依頼する

## Compact時の指示
会話を要約するとき、以下を必ず保持すること:
- 変更したファイル一覧とその理由
- 残っているエラーメッセージと解決案
- DynamoDBキー設計・アクセスパターンの変更内容
- APIエンドポイントの変更内容
- LLMプロンプト（構造化・翻訳・要約）の変更内容
- CDKスタックのリソース変更内容
