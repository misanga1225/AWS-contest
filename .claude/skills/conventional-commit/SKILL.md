---
name: conventional-commit
description: |
  gitコミットやコミットメッセージ作成を求められたときに使う。
  「コミットして」「変更を保存して」「git commit」で発動する。
---

コミットメッセージは Conventional Commits 形式で書く。

## フォーマット

```
<type>(<scope>): <subject>

<body>
```

## type
- feat: 新機能
- fix: バグ修正
- refactor: リファクタリング（機能変更なし）
- test: テスト追加・修正
- docs: ドキュメント
- chore: ビルド・CI・依存関係
- perf: パフォーマンス改善
- ci: CI/CD設定

## scope（任意）
- backend, frontend, db, ci, config

## ルール
- subject は50文字以内、命令形、末尾ピリオドなし
- body は変更の「なぜ」を書く（「何を」はdiffでわかる）
- 複数の種類の変更を1コミットにまとめない
- マイグレーションとモデル変更は同じコミットに入れてよい
- breaking change があれば本文に `BREAKING CHANGE:` を入れる
