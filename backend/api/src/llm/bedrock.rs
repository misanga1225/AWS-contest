//! Amazon Bedrock (Anthropic Claude) による [`Llm`] 実装。
//!
//! invoke_model の Anthropic Messages API 形式でリクエストし、応答テキストから
//! JSON を抽出して domain 型に変換する。JSON パース失敗はパニックさせず伝播する。

use async_trait::async_trait;
use aws_sdk_bedrockruntime::Client;
use aws_sdk_bedrockruntime::primitives::Blob;
use domain::SummaryItem;
use serde_json::{Value, json};

use super::prompt;
use super::{
    Llm, LlmError, StructureRequest, StructuredCareMemo, SummarizeRequest, SummaryItemRaw,
};

/// Bedrock 実装。
pub struct BedrockLlm {
    client: Client,
    model_id: String,
}

impl BedrockLlm {
    pub fn new(client: Client, model_id: String) -> Self {
        Self { client, model_id }
    }

    /// system + user を渡し、応答テキストを返す。
    async fn invoke(&self, system: &str, user: String) -> Result<String, LlmError> {
        let body = json!({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1500,
            "temperature": 0.2,
            "system": system,
            "messages": [{ "role": "user", "content": user }],
        });
        let body_bytes = serde_json::to_vec(&body)
            .map_err(|e| LlmError::Invoke(format!("リクエスト直列化に失敗: {e}")))?;

        let resp = self
            .client
            .invoke_model()
            .model_id(&self.model_id)
            .content_type("application/json")
            .accept("application/json")
            .body(Blob::new(body_bytes))
            .send()
            .await
            .map_err(|e| LlmError::Invoke(e.to_string()))?;

        let value: Value = serde_json::from_slice(resp.body().as_ref())
            .map_err(|e| LlmError::Parse(format!("応答全体のパースに失敗: {e}")))?;

        // Anthropic Messages API: { "content": [ { "type": "text", "text": "..." } ] }
        let text = value
            .get("content")
            .and_then(Value::as_array)
            .and_then(|arr| {
                arr.iter()
                    .find_map(|c| c.get("text").and_then(Value::as_str))
            })
            .ok_or(LlmError::EmptyResponse)?;

        Ok(text.to_string())
    }
}

#[async_trait]
impl Llm for BedrockLlm {
    async fn structure(&self, req: StructureRequest) -> Result<StructuredCareMemo, LlmError> {
        let user = prompt::structure_user_prompt(&req);
        let text = self.invoke(&prompt::structure_system(), user).await?;
        let json_str = prompt::extract_json(&text)
            .ok_or_else(|| LlmError::Parse("JSON が見つかりません".to_string()))?;
        serde_json::from_str::<StructuredCareMemo>(json_str)
            .map_err(|e| LlmError::Parse(e.to_string()))
    }

    async fn summarize(&self, req: SummarizeRequest) -> Result<Vec<SummaryItem>, LlmError> {
        let user = prompt::summarize_user_prompt(&req);
        let text = self.invoke(&prompt::summarize_system(), user).await?;
        let json_str = prompt::extract_json(&text)
            .ok_or_else(|| LlmError::Parse("JSON が見つかりません".to_string()))?;
        let raw: Vec<SummaryItemRaw> =
            serde_json::from_str(json_str).map_err(|e| LlmError::Parse(e.to_string()))?;
        Ok(raw.into_iter().map(SummaryItem::from).collect())
    }
}
