//! テスト用のフェイク [`Storage`] / [`Transcriber`] 実装。
//!
//! S3 / Transcribe を呼ばず決定的な値を返し、音声アップロード〜文字起こしの
//! 縦割りをオフラインで検証できるようにする。

use async_trait::async_trait;

use super::{JobState, Storage, StorageError, TranscribeError, Transcriber};

/// フェイクの文字起こし結果テキスト (テストのアサーションに使う)。
pub const FAKE_TRANSCRIPT: &str = "フェイク文字起こし結果";

/// プリサインド URL を決定的に返し、結果取得は Transcribe 形式の JSON を返すフェイク。
///
/// `content_length` はサイズ上限チェックのテスト用に差し替え可能 (既定は十分小さい値)。
#[derive(Debug, Clone)]
pub struct FakeStorage {
    content_length: u64,
}

impl Default for FakeStorage {
    fn default() -> Self {
        Self {
            content_length: 1024,
        }
    }
}

impl FakeStorage {
    pub fn new() -> Self {
        Self::default()
    }

    /// アップロード済みとみなすオブジェクトサイズを指定するフェイク
    /// (サイズ上限超過時の拒否をテストするため)。
    pub fn with_content_length(content_length: u64) -> Self {
        Self { content_length }
    }
}

#[async_trait]
impl Storage for FakeStorage {
    async fn presign_put(&self, key: &str, content_type: &str) -> Result<String, StorageError> {
        Ok(format!(
            "https://fake-s3.test/{key}?content-type={content_type}"
        ))
    }

    async fn get_object(&self, _key: &str) -> Result<Vec<u8>, StorageError> {
        // Amazon Transcribe の結果 JSON 形式を模す。
        let json =
            format!(r#"{{"results":{{"transcripts":[{{"transcript":"{FAKE_TRANSCRIPT}"}}]}}}}"#);
        Ok(json.into_bytes())
    }

    async fn content_length(&self, _key: &str) -> Result<u64, StorageError> {
        Ok(self.content_length)
    }
}

/// 開始したジョブを常に完了として返すフェイク。
#[derive(Debug, Default, Clone)]
pub struct FakeTranscriber;

impl FakeTranscriber {
    pub fn new() -> Self {
        FakeTranscriber
    }
}

#[async_trait]
impl Transcriber for FakeTranscriber {
    async fn start(
        &self,
        _job_name: &str,
        _media_key: &str,
        _language_code: &str,
        _output_key: &str,
    ) -> Result<(), TranscribeError> {
        Ok(())
    }

    async fn get(&self, _job_name: &str) -> Result<JobState, TranscribeError> {
        Ok(JobState::Completed)
    }
}
