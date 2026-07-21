//! 音声アップロード (S3) と文字起こし (Amazon Transcribe) の抽象。
//!
//! ケアメモを「話すだけ」で入力できるよう、ブラウザ録音をプリサインド URL で S3 に
//! 直接 PUT させ、バッチ Transcribe で文字起こしする。文字起こし結果は職員が Textarea で
//! 編集し、通常の記録投稿 (LLM 構造化) フローに合流する (LLM に音声を直接渡さない)。
//!
//! Bedrock / DynamoDB と同様、実体 (`s3`/`transcribe_aws`) とテスト用フェイク (`fake`) を
//! トレイトで差し替え可能にする。

use async_trait::async_trait;

pub mod fake;
pub mod s3;
pub mod transcribe_aws;

/// ストレージ (S3) 操作エラー。
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("プリサインド URL の発行に失敗しました: {0}")]
    Presign(String),
    #[error("オブジェクト取得に失敗しました: {0}")]
    Get(String),
}

/// 文字起こし (Transcribe) 操作エラー。
#[derive(Debug, thiserror::Error)]
pub enum TranscribeError {
    #[error("文字起こしジョブの開始に失敗しました: {0}")]
    Start(String),
    #[error("文字起こしジョブの取得に失敗しました: {0}")]
    Get(String),
}

/// 文字起こしジョブの状態。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobState {
    /// 処理中 (キュー投入・実行中)
    InProgress,
    /// 完了 (結果 JSON がバケットに書き出されている)
    Completed,
    /// 失敗
    Failed,
}

/// オブジェクトストレージ (S3) の抽象。
///
/// ブラウザからの直 PUT はプリサインド URL を使う (Lambda を経由せず、認証済み職員が
/// 発行された短命 URL でアップロードする)。文字起こし結果 JSON の取得にも使う。
#[async_trait]
pub trait Storage: Send + Sync {
    /// 指定キーへ PUT するための短命プリサインド URL を発行する。
    async fn presign_put(&self, key: &str, content_type: &str) -> Result<String, StorageError>;

    /// オブジェクト本文をバイト列で取得する。
    async fn get_object(&self, key: &str) -> Result<Vec<u8>, StorageError>;
}

/// バッチ文字起こし (Amazon Transcribe) の抽象。
#[async_trait]
pub trait Transcriber: Send + Sync {
    /// 文字起こしジョブを開始する。
    ///
    /// - `job_name`: ジョブ名 (`wabisuke-{ulid}`)。結果 JSON の出力キーにも使う。
    /// - `media_key`: 音声バケット内の入力キー (`audio/{ulid}.{ext}`)。
    /// - `language_code`: Transcribe の言語コード (`ja-JP`/`en-US`/`vi-VN`)。
    /// - `output_key`: 結果 JSON の出力キー (`transcripts/{job}.json`)。
    async fn start(
        &self,
        job_name: &str,
        media_key: &str,
        language_code: &str,
        output_key: &str,
    ) -> Result<(), TranscribeError>;

    /// ジョブの状態を取得する。
    async fn get(&self, job_name: &str) -> Result<JobState, TranscribeError>;
}
