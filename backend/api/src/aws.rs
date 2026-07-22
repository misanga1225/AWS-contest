//! AWS クライアント生成。
//!
//! aws-lc-sys (cmake/NASM 要求) を避けるため、TLS は ring バックエンドの rustls を
//! 明示注入する。生成した SdkConfig から DynamoDB / Bedrock クライアントを作る。

use std::sync::Arc;

use aws_config::BehaviorVersion;
use aws_smithy_http_client::{Builder, tls};

use crate::config::AppConfig;
use crate::llm::bedrock::BedrockLlm;
use crate::media::s3::S3Storage;
use crate::media::transcribe_aws::AwsTranscriber;
use crate::repository::dynamo::DynamoRepository;
use crate::state::AppState;

/// ring rustls を注入した共有 SDK 設定を読み込む。
pub async fn load_sdk_config() -> aws_config::SdkConfig {
    let http_client = Builder::new()
        .tls_provider(tls::Provider::Rustls(
            tls::rustls_provider::CryptoMode::Ring,
        ))
        .build_https();
    aws_config::defaults(BehaviorVersion::latest())
        .http_client(http_client)
        .load()
        .await
}

/// 本番用の [`AppState`] を構築する (DynamoDB + Bedrock 実装)。
pub async fn build_state(config: AppConfig) -> Arc<AppState> {
    let shared = load_sdk_config().await;
    let dynamo = aws_sdk_dynamodb::Client::new(&shared);
    let bedrock = aws_sdk_bedrockruntime::Client::new(&shared);
    let s3 = aws_sdk_s3::Client::new(&shared);
    let transcribe = aws_sdk_transcribe::Client::new(&shared);

    let repo = Arc::new(DynamoRepository::new(
        dynamo,
        config.table_name.clone(),
        config.index_name.clone(),
    ));
    let llm = Arc::new(BedrockLlm::new(bedrock, config.bedrock_model_id.clone()));
    let storage = Arc::new(S3Storage::new(s3, config.audio_bucket.clone()));
    let transcriber = Arc::new(AwsTranscriber::new(
        transcribe,
        config.audio_bucket.clone(),
        config.transcribe_data_access_role_arn.clone(),
    ));
    AppState::new(repo, llm, storage, transcriber, config)
}
