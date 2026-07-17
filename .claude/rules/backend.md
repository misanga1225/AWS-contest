---
paths:
  - backend/**
---

- DBアクセスには aws-sdk-dynamodb + serde_dynamo を使う。domain クレートの型と `to_item` / `from_item` で相互変換し、アイテムを手組みで構築しない
- 取得は Query + キー条件（`begins_with(SK, ...)`）を使う。Scan はデモデータ初期化を除き禁止
- テーブル名・GSI名・シフト時刻などの設定値は環境変数 / SSM Parameter Store から取得する。ハードコード禁止
- Bedrock呼び出しは aws-sdk-bedrockruntime を使い、トレイトで抽象化する（テストでフェイク実装に差し替えるため）
- LLMレスポンスのJSONパース失敗は専用エラー型で伝播する。パニックさせない
- LLM出力はそのまま確定保存しない。必ず draft → 職員承認 (approved) のフローを通す
- 母語入力の原文 (original_text) と言語コード (lang) を必ず保存する
- エラー型は thiserror で定義し、ハンドラでは専用エラー型を返す。anyhow はバイナリのエントリポイント層のみ
- unwrap() はテストコードのみ許可。プロダクションコードでは ? 演算子を使う
- ハンドラは薄く保つ。ビジネスロジックは services/ に分離する
- Axum の State には Arc<AppState> を使う
- 新しいルートを追加したら routes/mod.rs の Router に登録する
- domain の型には schema_version フィールドを持たせ、フィールド追加は `#[serde(default)]` を付ける（前方互換）
- tracing で構造化ログを出す。利用者の個人情報（氏名等）はログに出さない
- 統合テストは各クレートの tests/ ディレクトリに置き、DynamoDB Local を使う
