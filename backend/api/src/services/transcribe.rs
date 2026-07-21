//! 音声アップロード〜バッチ文字起こしのビジネスロジック。
//!
//! フロー: `create_upload_url` でプリサインド PUT URL を発行 → ブラウザが S3 へ直 PUT →
//! `start_transcription` でジョブ開始 → `get_transcription` をポーリングして完了時に
//! 文字起こしテキストを返す。テキストは職員が編集し、通常の記録投稿 (LLM 構造化) に合流する。
//!
//! LLM に音声・利用者同定はさせない。ここは「話した内容を文字化する」だけに限定する。

use serde_json::Value;

use crate::config::transcribe_language_code;
use crate::error::ApiError;
use crate::media::{JobState, Storage, Transcriber};
use crate::util::new_id;

/// 受け付ける音声 content-type と拡張子の対応 (Transcribe 対応フォーマットに限定)。
/// ブラウザの MediaRecorder は環境により webm/opus か mp4 を出す。
const ALLOWED_AUDIO: &[(&str, &str)] = &[
    ("audio/webm", "webm"),
    ("audio/ogg", "ogg"),
    ("audio/mp4", "mp4"),
    ("audio/mpeg", "mp3"),
    ("audio/wav", "wav"),
    ("audio/x-wav", "wav"),
    ("audio/flac", "flac"),
];

/// プリサインド URL 発行の結果。
pub struct AudioUploadUrl {
    /// S3 へ直接 PUT するためのプリサインド URL。
    pub url: String,
    /// アップロード先キー (`start_transcription` にそのまま渡す)。
    pub key: String,
}

/// 文字起こしのポーリング結果。
pub enum TranscriptionOutcome {
    /// まだ処理中 (クライアントは間隔を空けて再取得する)。
    InProgress,
    /// 失敗。
    Failed,
    /// 完了。文字起こしテキストを含む。
    Completed(String),
}

/// 音声アップロード用のプリサインド PUT URL を発行する。
///
/// content-type と拡張子は許可リストで検証する (任意キーへの書き込み・非対応形式を防ぐ)。
pub async fn create_upload_url(
    storage: &dyn Storage,
    content_type: &str,
    ext: &str,
) -> Result<AudioUploadUrl, ApiError> {
    let ct = content_type.trim().to_lowercase();
    let ext = ext.trim().to_lowercase();
    // content-type と拡張子の組が許可リストに一致することを要求する。
    let allowed = ALLOWED_AUDIO.iter().any(|(c, e)| *c == ct && *e == ext);
    if !allowed {
        return Err(ApiError::BadRequest(format!(
            "未対応の音声形式です: {content_type}/{ext}"
        )));
    }
    let key = format!("audio/{}.{ext}", new_id());
    let url = storage.presign_put(&key, &ct).await?;
    Ok(AudioUploadUrl { url, key })
}

/// アップロード済み音声の文字起こしジョブを開始し、ジョブ名を返す。
pub async fn start_transcription(
    transcriber: &dyn Transcriber,
    key: &str,
    lang: &str,
) -> Result<String, ApiError> {
    // key は create_upload_url が発行した `audio/{ulid}.{ext}` 形式のみ受け付ける。
    if !is_valid_audio_key(key) {
        return Err(ApiError::BadRequest("不正な音声キーです".to_string()));
    }
    let language_code = transcribe_language_code(lang)
        .ok_or_else(|| ApiError::BadRequest(format!("未対応の言語です: {lang}")))?;

    let job_name = format!("wabisuke-{}", new_id());
    let output_key = transcript_key(&job_name);
    transcriber
        .start(&job_name, key, language_code, &output_key)
        .await?;
    Ok(job_name)
}

/// 文字起こしジョブの状態を取得し、完了していればテキストを返す。
pub async fn get_transcription(
    transcriber: &dyn Transcriber,
    storage: &dyn Storage,
    job_name: &str,
) -> Result<TranscriptionOutcome, ApiError> {
    if !is_valid_job_name(job_name) {
        return Err(ApiError::BadRequest("不正なジョブ名です".to_string()));
    }
    match transcriber.get(job_name).await? {
        JobState::InProgress => Ok(TranscriptionOutcome::InProgress),
        JobState::Failed => Ok(TranscriptionOutcome::Failed),
        JobState::Completed => {
            let bytes = storage.get_object(&transcript_key(job_name)).await?;
            let text = parse_transcript(&bytes)?;
            Ok(TranscriptionOutcome::Completed(text))
        }
    }
}

/// 結果 JSON の出力キー。
fn transcript_key(job_name: &str) -> String {
    format!("transcripts/{job_name}.json")
}

/// `audio/{ulid}.{ext}` 形式か検証する (英数キー + 許可拡張子)。
fn is_valid_audio_key(key: &str) -> bool {
    let Some(rest) = key.strip_prefix("audio/") else {
        return false;
    };
    let Some((stem, ext)) = rest.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && stem.chars().all(|c| c.is_ascii_alphanumeric())
        && ALLOWED_AUDIO.iter().any(|(_, e)| *e == ext)
}

/// `wabisuke-{ulid}` 形式か検証する (パストラバーサル・任意オブジェクト取得を防ぐ)。
fn is_valid_job_name(job: &str) -> bool {
    match job.strip_prefix("wabisuke-") {
        Some(id) => !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()),
        None => false,
    }
}

/// Amazon Transcribe の結果 JSON から文字起こしテキストを取り出す。
///
/// 形式: `{"results": {"transcripts": [{"transcript": "..."}]}}`。
fn parse_transcript(bytes: &[u8]) -> Result<String, ApiError> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|e| ApiError::BadRequest(format!("文字起こし結果の解析に失敗しました: {e}")))?;
    let text = value
        .get("results")
        .and_then(|r| r.get("transcripts"))
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .and_then(|t| t.get("transcript"))
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::BadRequest("文字起こし結果が空です".to_string()))?;
    Ok(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_audio_key_accepts_expected_shape() {
        assert!(is_valid_audio_key("audio/01HXABC.webm"));
        assert!(is_valid_audio_key("audio/01hxabc.mp4"));
    }

    #[test]
    fn valid_audio_key_rejects_traversal_and_bad_ext() {
        assert!(!is_valid_audio_key("audio/../secret.webm"));
        assert!(!is_valid_audio_key("transcripts/x.json"));
        assert!(!is_valid_audio_key("audio/x.exe"));
        assert!(!is_valid_audio_key("audio/.webm"));
    }

    #[test]
    fn valid_job_name_rejects_traversal() {
        assert!(is_valid_job_name("wabisuke-01HXABC"));
        assert!(!is_valid_job_name("wabisuke-../../etc"));
        assert!(!is_valid_job_name("other-01HX"));
        assert!(!is_valid_job_name("wabisuke-"));
    }

    #[test]
    fn parse_transcript_extracts_text() {
        let json = r#"{"results":{"transcripts":[{"transcript":"こんにちは"}]}}"#;
        assert_eq!(parse_transcript(json.as_bytes()).unwrap(), "こんにちは");
    }

    #[test]
    fn parse_transcript_errors_on_missing_field() {
        let json = br#"{"results":{"transcripts":[]}}"#;
        assert!(parse_transcript(json).is_err());
    }
}
