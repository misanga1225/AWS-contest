---
name: db-migration
description: |
  DBスキーマ変更、マイグレーション作成、Turso操作を求められたときに使う。
  テーブル追加・カラム変更・インデックス作成・データモデル設計にも使う。
  「DBを変更」「テーブルを作って」「スキーマを更新」「マイグレーション」で発動する。
---

## Turso + sqlx マイグレーション手順

1. `sqlx migrate add <descriptive_name>` で UP/DOWN ファイルを作成
2. UP マイグレーションを書く
3. DOWN マイグレーション（ロールバック）を必ず書く
4. `sqlx migrate run --database-url $DATABASE_URL` で適用
5. 対応する Rust モデル (backend/src/models/) を更新
6. 統合テストを更新・追加

## SQLite/libSQL 制約（Turso固有）

Tursoは libSQL (SQLite互換) なので以下に注意:
- ALTER TABLE で既存カラムの型変更はできない → 新テーブル作成 + データ移行
- ALTER TABLE で NOT NULL の追加・削除もできない
- ENUM型はない → TEXT + CHECK制約 を使う
- BOOLEAN はない → INTEGER (0/1) を使う
- SERIAL はない → INTEGER PRIMARY KEY で自動採番
- NOW() はない → datetime('now') を使う
- RETURNING句はない → INSERT後に last_insert_rowid() で取得
- JSONB はない → TEXT で格納しアプリ側でパース
- 配列型はない → 別テーブルに正規化

## マイグレーションテンプレート

```sql
-- UP: {timestamp}_add_users_table.sql
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
```

```sql
-- DOWN: {timestamp}_add_users_table.sql
DROP INDEX IF EXISTS idx_users_email;
DROP TABLE IF EXISTS users;
```

## チェックリスト

マイグレーション作成後、以下を確認:
- [ ] IF NOT EXISTS / IF EXISTS が付いている（冪等性）
- [ ] NOT NULL カラムには DEFAULT がある
- [ ] DOWN マイグレーションが書かれている
- [ ] インデックスが必要なカラムに作成されている
- [ ] created_at, updated_at が含まれている
- [ ] 対応する Rust 構造体が更新されている
- [ ] 統合テストが更新されている
