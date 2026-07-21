//! 共有ドメイン型クレート。
//!
//! `CareRecord` / `Resident` / `HandoverSummary` などの serde 構造体を定義する。
//! 各型は `schema_version` フィールドと `#[serde(default)]` で前方互換を確保する
//! (DynamoDB にマイグレーションは無いため、旧アイテムを読めるようにする)。
//!
//! DynamoDB のキー生成は [`keys`] モジュールに集約し、api / summarizer で共有する。

use serde::{Deserialize, Serialize};

pub mod keys;
pub mod shift;

/// 現在のスキーマバージョン。構造を破壊的に変えたらインクリメントする。
///
/// v2: `CareRecord.verification_text` (逆翻訳の確認用テキスト) を追加。
pub const SCHEMA_VERSION: u32 = 2;

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

/// ケア記録のカテゴリ。LLM が構造化時に付与し、職員が承認前に修正できる。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    /// 食事
    Meal,
    /// 水分
    Hydration,
    /// 排泄
    Toileting,
    /// バイタル
    Vitals,
    /// インシデント
    Incident,
    /// 特記
    Note,
}

/// 記録の確定状態。LLM 出力は必ず `Draft` で保存し、職員承認で `Approved` になる。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordStatus {
    /// 下書き (LLM が構造化した直後、未承認)
    Draft,
    /// 承認済み (職員が確認・承認済み。物理削除・上書き禁止)
    Approved,
}

/// 利用者の在籍状態。
///
/// ケア記録には法定の保存義務 (介護保険法: 完結の日から2年、自治体条例で5年の場合あり) が
/// あり、記録が参照する利用者を物理削除すると「誰の記録か分からない」状態になる。
/// そのため記録が1件でもある利用者は物理削除せず `Discharged` にして一覧から外す。
/// 記録が無い利用者 (誤登録・テストデータ) は保存義務が無いので物理削除してよい。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResidentStatus {
    /// 在籍中
    #[default]
    Active,
    /// 退所済み (記録は保存されたまま、利用者一覧の既定表示からは外れる)
    Discharged,
}

/// 申し送りサマリの優先度 3 段階。診断ではなく確認を促すための整理。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    /// 要注意
    Attention,
    /// 変化あり
    Change,
    /// 特記なし
    None,
}

/// ケア記録。
///
/// PK=`FLOOR#{floor}` / SK=`RECORD#{created_at}#{id}`。
/// 承認済み記録の物理削除・上書きは禁止。訂正は新規記録として追加する。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CareRecord {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    /// ULID (時系列ソート可能)
    pub id: String,
    /// フロア識別子 (例: "3")
    pub floor: String,
    /// 対象利用者の id
    pub resident_id: String,
    pub category: Category,
    /// 正規化された日本語本文 (LLM が構造化)
    pub body_ja: String,
    /// 母語入力の原文 (必ず保存)
    pub original_text: String,
    /// 原文の言語コード (BCP-47 相当。例: "ja", "en", "vi")
    pub lang: String,
    /// lang≠ja のとき、`body_ja` を原文言語へ逆翻訳した確認用テキスト。
    ///
    /// 外国人職員が承認前に「日本語へ整形した内容」を母語で照合するために使う
    /// (承認=human-in-the-loop の実効性を担保する)。ja のとき・逆翻訳が無いときは None。
    #[serde(default)]
    pub verification_text: Option<String>,
    pub status: RecordStatus,
    /// 作成者の Cognito サブジェクト (証跡)
    pub created_by: String,
    /// RFC3339 UTC 文字列 (SK のソート順に使う)
    pub created_at: String,
    /// 承認者の Cognito サブジェクト
    #[serde(default)]
    pub approved_by: Option<String>,
    /// 承認時刻 (RFC3339 UTC)。サマリ後の「追記」判定に使う
    #[serde(default)]
    pub approved_at: Option<String>,
}

/// 利用者マスタ。
///
/// PK=`FLOOR#{floor}` / SK=`RESIDENT#{id}`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Resident {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub id: String,
    pub floor: String,
    /// 氏名 (ログ出力禁止の個人情報)
    pub name: String,
    /// 居室番号
    pub room: String,
    /// 平常時情報 (baseline)。サマリ生成時に変化の判断材料として渡す
    #[serde(default)]
    pub baseline: String,
    pub created_at: String,
    /// 在籍状態。既存アイテムには属性が無いため default (= Active) で読む
    #[serde(default)]
    pub status: ResidentStatus,
    /// 退所時刻 (RFC3339 UTC)。在籍中は None
    #[serde(default)]
    pub discharged_at: Option<String>,
}

/// 申し送りサマリの 1 項目。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SummaryItem {
    pub priority: Priority,
    /// 対象利用者 (フロア全体の総括は None)
    #[serde(default)]
    pub resident_id: Option<String>,
    /// 要約本文 (日本語)
    pub text: String,
    /// 根拠として参照した記録 id 群 (ドリルダウン用)
    #[serde(default)]
    pub evidence_record_ids: Vec<String>,
}

/// 横断申し送りサマリ。
///
/// PK=`FLOOR#{floor}` / SK=`SUMMARY#{date}#{shift}`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HandoverSummary {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub floor: String,
    /// 対象日 (YYYY-MM-DD)
    pub date: String,
    /// シフト帯 ("day" | "night")
    pub shift: String,
    pub items: Vec<SummaryItem>,
    /// 生成時刻 (RFC3339 UTC)。追記判定 (`approved_at > generated_at`) の基準
    pub generated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&Category::Incident).unwrap(),
            "\"incident\""
        );
        assert_eq!(
            serde_json::from_str::<Category>("\"vitals\"").unwrap(),
            Category::Vitals
        );
    }

    #[test]
    fn priority_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&Priority::Attention).unwrap(),
            "\"attention\""
        );
    }

    #[test]
    fn old_item_without_new_optional_fields_still_deserializes() {
        // approved_by / approved_at / schema_version を欠いた旧アイテムを想定
        let json = r#"{
            "id": "01H",
            "floor": "3",
            "resident_id": "r1",
            "category": "meal",
            "body_ja": "朝食全量摂取",
            "original_text": "朝食全量摂取",
            "lang": "ja",
            "status": "draft",
            "created_by": "u1",
            "created_at": "2026-07-19T00:00:00Z"
        }"#;
        let rec: CareRecord = serde_json::from_str(json).unwrap();
        assert_eq!(rec.schema_version, SCHEMA_VERSION);
        assert_eq!(rec.approved_at, None);
        assert_eq!(rec.status, RecordStatus::Draft);
    }

    #[test]
    fn resident_without_status_reads_as_active() {
        // status / discharged_at を持たない既存アイテムを想定。
        // バックフィルはしない規約のため、読み取り時に既定値で吸収できる必要がある。
        let json = r#"{
            "id": "r1",
            "floor": "3",
            "name": "山田 太郎",
            "room": "301",
            "created_at": "2026-07-19T00:00:00Z"
        }"#;
        let r: Resident = serde_json::from_str(json).unwrap();
        assert_eq!(r.schema_version, SCHEMA_VERSION);
        assert_eq!(r.status, ResidentStatus::Active);
        assert_eq!(r.discharged_at, None);
        assert_eq!(r.baseline, "");
    }

    #[test]
    fn resident_status_serializes_snake_case() {
        let json = serde_json::to_string(&ResidentStatus::Discharged).unwrap();
        assert_eq!(json, "\"discharged\"");
    }
}
