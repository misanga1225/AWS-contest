//! Amazon S3 による [`Storage`] 実装。
//!
//! 音声はブラウザからプリサインド URL で直接 PUT させ、文字起こし結果 JSON は
//! Lambda が `get_object` で取得する。バケットは 1 日ライフサイクルで失効削除する
//! 前提 (PII 音声を残さない。infra 側で設定)。

use std::time::Duration;

use async_trait::async_trait;
use aws_sdk_s3::Client;
use aws_sdk_s3::presigning::PresigningConfig;

use super::{Storage, StorageError};

/// プリサインド URL の有効期限。録音〜アップロード完了に十分な短命値。
const PRESIGN_EXPIRES: Duration = Duration::from_secs(300);

/// S3 実装。
pub struct S3Storage {
    client: Client,
    bucket: String,
}

impl S3Storage {
    pub fn new(client: Client, bucket: String) -> Self {
        Self { client, bucket }
    }
}

#[async_trait]
impl Storage for S3Storage {
    async fn presign_put(&self, key: &str, content_type: &str) -> Result<String, StorageError> {
        let presigning = PresigningConfig::expires_in(PRESIGN_EXPIRES)
            .map_err(|e| StorageError::Presign(e.to_string()))?;
        let presigned = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .presigned(presigning)
            .await
            .map_err(|e| StorageError::Presign(e.to_string()))?;
        Ok(presigned.uri().to_string())
    }

    async fn get_object(&self, key: &str) -> Result<Vec<u8>, StorageError> {
        let resp = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| StorageError::Get(e.to_string()))?;
        let bytes = resp
            .body
            .collect()
            .await
            .map_err(|e| StorageError::Get(e.to_string()))?;
        Ok(bytes.into_bytes().to_vec())
    }
}
