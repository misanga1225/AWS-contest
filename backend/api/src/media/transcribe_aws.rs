//! Amazon Transcribe による [`Transcriber`] 実装 (バッチ方式)。
//!
//! `StartTranscriptionJob` で S3 上の音声を文字起こしし、結果 JSON を同じ音声バケットの
//! `transcripts/` 配下へ書き出す。東京リージョン (ap-northeast-1) で ja/en/vi 全対応。

use async_trait::async_trait;
use aws_sdk_transcribe::Client;
use aws_sdk_transcribe::types::{LanguageCode, Media, TranscriptionJobStatus};

use super::{JobState, TranscribeError, Transcriber};

/// Transcribe 実装。音声・結果とも同一バケットを使う。
pub struct AwsTranscriber {
    client: Client,
    /// 音声入力と結果 JSON の出力を兼ねるバケット。
    bucket: String,
}

impl AwsTranscriber {
    pub fn new(client: Client, bucket: String) -> Self {
        Self { client, bucket }
    }
}

#[async_trait]
impl Transcriber for AwsTranscriber {
    async fn start(
        &self,
        job_name: &str,
        media_key: &str,
        language_code: &str,
        output_key: &str,
    ) -> Result<(), TranscribeError> {
        let media_uri = format!("s3://{}/{}", self.bucket, media_key);
        let media = Media::builder().media_file_uri(media_uri).build();
        self.client
            .start_transcription_job()
            .transcription_job_name(job_name)
            .language_code(LanguageCode::from(language_code))
            .media(media)
            .output_bucket_name(&self.bucket)
            .output_key(output_key)
            .send()
            .await
            .map_err(|e| TranscribeError::Start(e.to_string()))?;
        Ok(())
    }

    async fn get(&self, job_name: &str) -> Result<JobState, TranscribeError> {
        let resp = self
            .client
            .get_transcription_job()
            .transcription_job_name(job_name)
            .send()
            .await
            .map_err(|e| TranscribeError::Get(e.to_string()))?;
        let status = resp
            .transcription_job()
            .and_then(|j| j.transcription_job_status());
        Ok(match status {
            Some(TranscriptionJobStatus::Completed) => JobState::Completed,
            Some(TranscriptionJobStatus::Failed) => JobState::Failed,
            // Queued / InProgress / 未知の状態はまだ待つ (ポーリング継続)
            _ => JobState::InProgress,
        })
    }
}
