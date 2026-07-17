---
name: dynamodb-design
description: |
  DynamoDBのデータモデル変更、アクセスパターン追加、キー設計、エンティティ追加を求められたときに使う。
  「DBを変更」「テーブルを変えたい」「スキーマを更新」「アクセスパターン」「GSI」で発動する。
---

## 前提

DynamoDB 単一テーブル設計。RDBのマイグレーションは存在しない。
スキーマ進化は「後方互換な属性追加 + schema_version + serde default」で行う。

## 変更手順

1. 新しいアクセスパターンを一文で言語化する（例:「利用者IDで記録を新しい順に取る」）
2. 既存のキー設計（PK/SK/GSI1）で満たせるか確認する。満たせるなら domain とクエリの変更のみ
3. domain クレートの型を更新する
   - フィールド追加には `#[serde(default)]` を付ける
   - 構造が変わるなら schema_version をインクリメントする
4. GSI追加・キー変更が必要な場合はユーザーの承認を得てから infra/ のCDKを変更する
5. `npx cdk synth` で検証し、`cdk diff` で影響を確認する
6. 統合テスト（DynamoDB Local）を更新・追加する

## キー設計（現行）

| エンティティ | PK | SK |
|---|---|---|
| ケア記録 | `FLOOR#{floor}` | `RECORD#{timestamp}#{id}` |
| 利用者 | `FLOOR#{floor}` | `RESIDENT#{id}` |
| サマリ | `FLOOR#{floor}` | `SUMMARY#{date}#{shift}` |

GSI1（利用者別時系列）: PK=`RESIDENT#{id}`, SK=`RECORD#{timestamp}`

## 制約

- 既存属性のリネーム・型変更・削除は禁止。新属性追加 + 読み取り側で両対応する
- 既存アイテムの一括書き換え（バックフィル）はしない。読み取り時に吸収する
- Scan 禁止（デモデータ初期化を除く）。必ず Query + begins_with で設計する
- タイムスタンプは RFC 3339 UTC 文字列、id は ULID（SKのソート順が壊れるため変更禁止）
- テーブル・GSI定義の変更は CDK 経由のみ。手動変更禁止

## チェックリスト

- [ ] アクセスパターンが Query（Scanなし）で実現できる
- [ ] `#[serde(default)]` が新フィールドに付いている
- [ ] schema_version の要否を判断した
- [ ] 旧形式アイテムを読むテストがある
- [ ] CDK変更がある場合 `cdk synth` が通る
- [ ] 統合テストが更新されている
