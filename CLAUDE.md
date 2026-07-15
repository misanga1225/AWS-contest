# Project

Rust (Axum) バックエンド + TypeScript フロントエンド
## コマンド

### バックエンド (backend/)
- `cargo build` — ビルド
- `cargo test` — テスト（統合テスト中心）
- `cargo clippy -- -D warnings` — lint
- `cargo fmt --check` — フォーマットチェック

### フロントエンド (frontend/)
- `npm run dev` — 開発サーバー
- `npm run build` — プロダクションビルド
- `npx vitest run` — テスト
- `npm run lint` — ESLint
- `npx tsc --noEmit` — 型チェック

### DB
- `sqlx migrate run --database-url $DATABASE_URL` — マイグレーション適用
- `sqlx migrate add <name>` — マイグレーションファイル作成
- `sqlx migrate revert --database-url $DATABASE_URL` — ロールバック

## 規約
- Rustのエラー処理は thiserror + anyhow。panic!は禁止
- フロントエンドの型は `any` 禁止。API応答には必ず型を定義する
- テストトロフィー: ユニットテストよりも統合テストを優先する
- DB変更は必ずマイグレーションファイルを通す。手動ALTER禁止

## 禁止事項
- テスト削除・アサーション弱体化で通すことは絶対に禁止
- unwrap() をプロダクションコードで使わない（テストコードでは可）
- .env ファイルをgitに含めない
- チェック出力なしで「完了」と報告することを禁止する

## ループ協議
1. 変更を書く
2. バックエンド → `cargo test` + `cargo clippy` / フロントエンド → `vitest` + `tsc`
3. 失敗 → エラーを読み、修正して 2 へ戻る
4. 同じエラーが2回連続 → @fixer を呼ぶ
5. 全チェック通過後、@reviewer に差分レビューを依頼する

## Compact時の指示
会話を要約するとき、以下を必ず保持すること:
- 変更したファイル一覧とその理由
- 残っているエラーメッセージと解決案
- DBスキーマの変更内容
- APIエンドポイントの変更内容
