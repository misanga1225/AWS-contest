---
paths:
  - backend/**
  - infra/lib/**
---

# DynamoDB 単一テーブル設計規約

- DB は DynamoDB 単一テーブル（オンデマンド課金）。テーブル・GSI定義は infra/ の CDK でのみ管理する
- コンソール・CLI (`aws dynamodb create-table` / `update-table` 等) での手動変更は禁止

## キー設計

| エンティティ | PK | SK |
|---|---|---|
| ケア記録 | `FLOOR#{floor}` | `RECORD#{timestamp}#{id}` |
| 利用者 | `FLOOR#{floor}` | `RESIDENT#{id}` |
| サマリ | `FLOOR#{floor}` | `SUMMARY#{date}#{shift}` |

- GSI は1本のみ（利用者別時系列: PK=`RESIDENT#{id}`, SK=`RECORD#{timestamp}`）。GSIの追加はユーザーの承認を得てから
- SKプレフィックス（`RECORD#` / `RESIDENT#` / `SUMMARY#`）で `begins_with` クエリする。Scan は禁止（デモデータ初期化を除く）

## スキーマ進化（DynamoDBにマイグレーションは無い）

- 全エンティティに schema_version 属性を持たせる。構造を変えたらインクリメントする
- フィールド追加は domain クレートで `#[serde(default)]` を付け、旧アイテムを読めるようにする
- 既存属性のリネーム・型変更・削除は禁止。新属性を追加し、読み取り側で両対応する
- 既存アイテムの一括書き換え（バックフィル）はしない。読み取り時に吸収する

## データ規約

- タイムスタンプは ISO 8601 / RFC 3339 のUTC文字列（例: `2026-07-17T09:00:00Z`）。SKのソート順がこれに依存する
- id は ULID（時系列ソート可能）
- 承認済み記録の物理削除・上書きは禁止。訂正は新規記録として追加する
- サマリ生成後に承認された記録の「追記」判定は、読み取り時に `approved_at > summary.generated_at` のクエリで行う。記録側にフラグは持たせない
- 記録には原文 (original_text)・言語コード (lang)・根拠として参照可能な id を必ず保持する
