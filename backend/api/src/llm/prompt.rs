//! Bedrock 向けプロンプト構築と応答パース。
//!
//! ガードレールをシステムプロンプトに明記する:
//! 診断・治療・ケア方針の提案をさせず、転記・翻訳・要約・整形と確認喚起に限定する。

use super::{StructureRequest, SummarizeRequest};

/// 構造化・翻訳のシステムプロンプト。
pub const STRUCTURE_SYSTEM: &str = "\
あなたは介護施設の記録作成を補助するアシスタントです。職員が入力したケアメモを、\
介護記録として構造化・整形し、日本語に翻訳します。\n\
厳守事項:\n\
- 診断・治療・投薬・ケア方針の提案は絶対に行わない。あなたの役割は転記・翻訳・整形のみ。\n\
- 入力に無い事実を創作しない。推測が必要な箇所は本文に含めず、職員の確認に委ねる。\n\
- 医療的判断を要する表現は避け、観察された事実の記述にとどめる。\n\
- 出力は必ず指定の JSON のみ。前置き・後置き・コードフェンスを付けない。";

/// 要約のシステムプロンプト。
pub const SUMMARIZE_SYSTEM: &str = "\
あなたは介護施設のシフト申し送りを補助するアシスタントです。承認済みのケア記録を、\
次の勤務者向けに優先度付きで要約・整理します。\n\
厳守事項:\n\
- 診断・治療・ケア方針の提案は絶対に行わない。記録内容の要約・整理と『確認を促す』表現に限定する。\n\
- 記録に無い事実を創作しない。evidence_record_ids には提示された記録の id のみを使う。\n\
- priority は次の3段階: attention(要注意=インシデントや平常時からの大きな変化), \
change(変化あり=平常時と異なる観察), none(特記なし)。\n\
- 出力は必ず指定の JSON のみ。前置き・後置き・コードフェンスを付けない。";

/// 構造化のユーザープロンプトを組み立てる。
pub fn structure_user_prompt(req: &StructureRequest) -> String {
    let residents_json = serde_json::to_string(&req.residents).unwrap_or_else(|_| "[]".to_string());
    format!(
        "# 利用者候補(この中から resident_id を選ぶ。該当なしは null)\n{residents}\n\n\
# 入力ケアメモ(母語の可能性あり)\n{text}\n\n\
# 出力(JSONのみ)\n\
以下の形式で返す:\n\
{{\"resident_id\": string|null, \"category\": \"meal|hydration|toileting|vitals|incident|note\", \
\"body_ja\": string, \"lang\": string}}\n\
- category は内容に最も合うものを1つ選ぶ。\n\
- body_ja は日本語の介護記録として簡潔に整形する。\n\
- lang は原文の言語コード(ja/en/vi など)。",
        residents = residents_json,
        text = req.text,
    )
}

/// 要約のユーザープロンプトを組み立てる。
pub fn summarize_user_prompt(req: &SummarizeRequest) -> String {
    let residents_json = serde_json::to_string(&req.residents).unwrap_or_else(|_| "[]".to_string());
    let records_json = serde_json::to_string(&req.records).unwrap_or_else(|_| "[]".to_string());
    format!(
        "# フロア\n{floor} / シフト: {shift}\n\n\
# 利用者の平常時情報\n{residents}\n\n\
# このシフトの承認済み記録\n{records}\n\n\
# 出力(JSONのみ)\n\
次の形式の配列を返す:\n\
[{{\"priority\": \"attention|change|none\", \"resident_id\": string|null, \"text\": string, \
\"evidence_record_ids\": [string]}}]\n\
- 利用者ごとに、平常時と比べた変化の有無で優先度を付ける。\n\
- text は次の勤務者が確認すべき点を簡潔にまとめ、必要なら『確認をお願いします』等の確認喚起で結ぶ。\n\
- 記録が無い、または特記が無い利用者は priority=none にまとめてよい。\n\
- evidence_record_ids は上記記録の id のみを使う。",
        floor = req.floor,
        shift = req.shift,
        residents = residents_json,
        records = records_json,
    )
}

/// LLM 応答テキストから JSON 本体を取り出す。
///
/// コードフェンスや前後の説明が混じっても、最初の `{`/`[` から対応する末尾までを抽出する。
pub fn extract_json(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    let start = bytes.iter().position(|&b| b == b'{' || b == b'[')?;
    let open = bytes[start];
    let close = if open == b'{' { b'}' } else { b']' };
    // 文字列リテラル内の括弧を無視しつつ対応を数える
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_str {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_str = false;
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            x if x == open => depth += 1,
            x if x == close => {
                depth -= 1;
                if depth == 0 {
                    return std::str::from_utf8(&bytes[start..=i]).ok();
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_handles_code_fence() {
        let t = "```json\n{\"a\": 1}\n```";
        assert_eq!(extract_json(t), Some("{\"a\": 1}"));
    }

    #[test]
    fn extract_json_handles_array_and_nested() {
        let t = "以下です: [{\"x\": {\"y\": 1}}] 終わり";
        assert_eq!(extract_json(t), Some("[{\"x\": {\"y\": 1}}]"));
    }

    #[test]
    fn extract_json_ignores_braces_in_strings() {
        let t = "{\"text\": \"a } b\"}";
        assert_eq!(extract_json(t), Some("{\"text\": \"a } b\"}"));
    }
}
