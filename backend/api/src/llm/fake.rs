//! テスト用のフェイク [`Llm`] 実装。Bedrock を呼ばず決定的な出力を返す。

use async_trait::async_trait;
use domain::{Category, Priority, SummaryItem};

use super::{Llm, LlmError, StructureRequest, StructuredCareMemo, SummarizeRequest};

/// 決定的な構造化・要約を返すフェイク。
///
/// - `structure`: 原文にカテゴリ語が含まれればそれを、無ければ `Note`。
///   利用者候補の氏名が原文に含まれればその id を採用。lang は簡易判定。
/// - `summarize`: `incident` カテゴリの記録がある利用者は `Attention`、
///   記録がある利用者は `Change`、それ以外はまとめて `None`。
#[derive(Debug, Default, Clone)]
pub struct FakeLlm;

impl FakeLlm {
    pub fn new() -> Self {
        FakeLlm
    }
}

fn detect_lang(text: &str) -> String {
    if text.is_ascii() {
        "en".to_string()
    } else if text.chars().any(|c| ('\u{3040}'..='\u{30ff}').contains(&c)) {
        "ja".to_string()
    } else {
        "vi".to_string()
    }
}

fn detect_category(text: &str) -> Category {
    let t = text.to_lowercase();
    if t.contains("転倒") || t.contains("incident") || t.contains("怪我") {
        Category::Incident
    } else if t.contains("食事") || t.contains("meal") || t.contains("食べ") {
        Category::Meal
    } else if t.contains("水分") || t.contains("水") || t.contains("water") {
        Category::Hydration
    } else if t.contains("排泄") || t.contains("トイレ") {
        Category::Toileting
    } else if t.contains("血圧") || t.contains("体温") || t.contains("vitals") {
        Category::Vitals
    } else {
        Category::Note
    }
}

#[async_trait]
impl Llm for FakeLlm {
    async fn structure(&self, req: StructureRequest) -> Result<StructuredCareMemo, LlmError> {
        let lang = detect_lang(&req.text);
        // lang≠ja のとき、body_ja を原文言語へ逆翻訳した体の確認用テキストを返す。
        // 実 LLM は本当に逆翻訳するが、フェイクは決定的な目印付き文字列で十分
        // (create_draft が verification_text を保存する経路を検証できればよい)。
        let verification_text = if lang == "ja" {
            String::new()
        } else {
            format!("[{lang}逆翻訳] {}", req.text)
        };
        Ok(StructuredCareMemo {
            category: detect_category(&req.text),
            body_ja: req.text.clone(),
            lang,
            verification_text,
        })
    }

    async fn summarize(&self, req: SummarizeRequest) -> Result<Vec<SummaryItem>, LlmError> {
        let mut items = Vec::new();
        for resident in &req.residents {
            let recs: Vec<_> = req
                .records
                .iter()
                .filter(|r| r.resident_id == resident.id)
                .collect();
            if recs.is_empty() {
                items.push(SummaryItem {
                    priority: Priority::None,
                    resident_id: Some(resident.id.clone()),
                    text: "特記なし。".to_string(),
                    evidence_record_ids: Vec::new(),
                });
                continue;
            }
            let has_incident = recs.iter().any(|r| r.category == Category::Incident);
            let priority = if has_incident {
                Priority::Attention
            } else {
                Priority::Change
            };
            items.push(SummaryItem {
                priority,
                resident_id: Some(resident.id.clone()),
                text: format!("{} 件の記録あり。内容の確認をお願いします。", recs.len()),
                evidence_record_ids: recs.iter().map(|r| r.id.clone()).collect(),
            });
        }
        Ok(items)
    }
}
