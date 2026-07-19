//! LLM (Bedrock) 抽象。
//!
//! ガードレール: LLM には診断・治療・ケア方針の提案をさせない。
//! 記録の転記・翻訳・要約・整形と「確認を促す」表現に限定する。
//! 出力は必ず draft として保存し、職員承認を経てのみ確定する。
//!
//! テストでフェイク実装に差し替えるためトレイトで抽象化する。

use async_trait::async_trait;
use domain::{Category, Priority, SummaryItem};
use serde::{Deserialize, Serialize};

pub mod bedrock;
pub mod fake;
pub mod glossary;
pub mod prompt;

/// LLM 処理エラー。JSON パース失敗などをパニックさせず伝播する。
#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("Bedrock 呼び出しに失敗しました: {0}")]
    Invoke(String),
    #[error("LLM 応答の JSON パースに失敗しました: {0}")]
    Parse(String),
    #[error("LLM 応答に本文が含まれていません")]
    EmptyResponse,
}

/// 構造化の入力。母語入力の原文と、フロアの利用者一覧 (突合候補) を渡す。
#[derive(Debug, Clone)]
pub struct StructureRequest {
    /// 職員が入力した原文 (母語の可能性あり)
    pub text: String,
    /// 突合候補の利用者 (id と氏名)。LLM はこの中から resident_id を選ぶ
    pub residents: Vec<ResidentBrief>,
}

/// 突合用の利用者概要。
#[derive(Debug, Clone, Serialize)]
pub struct ResidentBrief {
    pub id: String,
    pub name: String,
    pub room: String,
}

/// 構造化の結果 (LLM 出力)。確定ではなく draft の材料。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StructuredCareMemo {
    /// 提示リストから選ばれた利用者 id。特定できなければ None (職員が補う)
    #[serde(default)]
    pub resident_id: Option<String>,
    pub category: Category,
    /// 正規化された日本語本文
    pub body_ja: String,
    /// 検出した原文の言語コード (例: "ja", "en", "vi")
    pub lang: String,
}

/// 要約の入力。
#[derive(Debug, Clone)]
pub struct SummarizeRequest {
    pub floor: String,
    pub shift: String,
    /// 対象シフトの承認済み記録
    pub records: Vec<RecordBrief>,
    /// 利用者の平常時情報 (変化判断の材料)
    pub residents: Vec<ResidentBaseline>,
}

/// 要約に渡す記録概要。
#[derive(Debug, Clone, Serialize)]
pub struct RecordBrief {
    pub id: String,
    pub resident_id: String,
    pub category: Category,
    pub body_ja: String,
    pub created_at: String,
}

/// 要約に渡す利用者の平常時情報。
#[derive(Debug, Clone, Serialize)]
pub struct ResidentBaseline {
    pub id: String,
    pub name: String,
    pub baseline: String,
}

/// 要約 1 項目の LLM 出力 (優先度は文字列で受け、[`domain::Priority`] に変換)。
#[derive(Debug, Clone, Deserialize)]
pub struct SummaryItemRaw {
    pub priority: Priority,
    #[serde(default)]
    pub resident_id: Option<String>,
    pub text: String,
    #[serde(default)]
    pub evidence_record_ids: Vec<String>,
}

impl From<SummaryItemRaw> for SummaryItem {
    fn from(r: SummaryItemRaw) -> Self {
        SummaryItem {
            priority: r.priority,
            resident_id: r.resident_id,
            text: r.text,
            evidence_record_ids: r.evidence_record_ids,
        }
    }
}

/// LLM の抽象。実体は Bedrock、テストは [`fake::FakeLlm`]。
#[async_trait]
pub trait Llm: Send + Sync {
    /// 母語入力を日本語の介護記録に構造化・翻訳する。
    async fn structure(&self, req: StructureRequest) -> Result<StructuredCareMemo, LlmError>;

    /// シフト分の承認済み記録を優先度付きサマリに要約する。
    async fn summarize(&self, req: SummarizeRequest) -> Result<Vec<SummaryItem>, LlmError>;
}
