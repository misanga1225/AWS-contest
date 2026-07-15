---
paths:
  - backend/**
---

- DBアクセスには sqlx を使う
- 単純なCRUDには sqlx::query! / sqlx::query_as! マクロを使い、型安全性を保つ
- ORMクレート（SeaORM, Diesel等）の併用は許可するが、以下の場合は生SQLを書く:
  - JOINが2テーブル以上にまたがるクエリ
  - サブクエリやCTEを含むクエリ
  - 集約（GROUP BY + HAVING）を含むクエリ
  - N+1問題が発生しうるリレーション取得
- 生SQLを書く場合も sqlx::query! マクロ経由で実行し、文字列結合でSQLを組み立てない
- エラー型は thiserror で定義し、ハンドラでは専用エラー型を返す
- unwrap() はテストコードのみ許可。プロダクションコードでは ? 演算子を使う
- ハンドラは薄く保つ。ビジネスロジックは services/ または models/ に分離する
- Axum の State には Arc<AppState> を使う
- 新しいルートを追加したら routes/mod.rs の Router に登録する
- 統合テストは tests/ ディレクトリに置き、テスト用DBを使う
