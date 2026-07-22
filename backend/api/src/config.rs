//! 実行時設定。値は env 経由 (infra が SSM Parameter Store から注入) で取得し、
//! コード内にハードコードしない。

use domain::shift::{ShiftConfig, ShiftError};
use std::env;

/// 設定読み込みエラー。
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("環境変数 {0} が未設定です")]
    Missing(&'static str),
    #[error("シフト設定が不正です: {0}")]
    Shift(#[from] ShiftError),
}

/// API Lambda の実行時設定。
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub table_name: String,
    /// 利用者別時系列 GSI の名前。
    pub index_name: String,
    pub bedrock_model_id: String,
    /// 音声アップロード・文字起こし結果を置く S3 バケット名。
    /// summarizer は使わないため、未設定でも起動を止めない (空文字許容)。
    pub audio_bucket: String,
    /// Amazon Transcribe が audio/*・transcripts/* を読み書きするために引き受けるロール ARN。
    /// summarizer は使わないため、未設定でも起動を止めない (空文字許容)。
    pub transcribe_data_access_role_arn: String,
    pub shift: ShiftConfig,
    /// デモデータ初期化やサマリ一括生成の対象フロア。
    pub floors: Vec<String>,
}

impl AppConfig {
    /// env から読み込む。`TABLE_NAME` は必須。シフト時刻は既定 (UTC 00:00-09:00 =
    /// JST 日勤 09:00-18:00 相当) を持つが、実運用では infra が SSM 値を注入する。
    pub fn from_env() -> Result<Self, ConfigError> {
        let table_name = env::var("TABLE_NAME").map_err(|_| ConfigError::Missing("TABLE_NAME"))?;
        // GSI 名は infra (CDK) が定義した物理名を INDEX_NAME として注入する。
        let index_name = env::var("INDEX_NAME").unwrap_or_else(|_| "GSI1".to_string());
        // モデル ID は infra が SSM 値を BEDROCK_MODEL_ID として注入する。
        let bedrock_model_id = env::var("BEDROCK_MODEL_ID")
            .unwrap_or_else(|_| "apac.anthropic.claude-3-haiku-20240307-v1:0".to_string());
        // 音声バケット名は infra が AUDIO_BUCKET として注入する。summarizer は使わないため
        // 未設定でも起動は止めず、音声系エンドポイント使用時にのみ問題化する。
        let audio_bucket = env::var("AUDIO_BUCKET").unwrap_or_default();
        let transcribe_data_access_role_arn =
            env::var("TRANSCRIBE_DATA_ACCESS_ROLE_ARN").unwrap_or_default();
        let day_start = env::var("SHIFT_DAY_START").unwrap_or_else(|_| "00:00".to_string());
        let day_end = env::var("SHIFT_DAY_END").unwrap_or_else(|_| "09:00".to_string());
        let shift = ShiftConfig::from_hhmm(&day_start, &day_end)?;
        let floors = env::var("FLOORS")
            .unwrap_or_else(|_| "1,2,3".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        Ok(AppConfig {
            table_name,
            index_name,
            bedrock_model_id,
            audio_bucket,
            transcribe_data_access_role_arn,
            shift,
            floors,
        })
    }
}

/// UI 言語コード (ja/en/vi) を Amazon Transcribe の言語コードへ写像する。
///
/// 話す言語は職員が画面で明示選択する (自動言語判定は使わない = 確実・低コスト)。
/// 対応外の言語は `None` を返し、ハンドラで 400 にする。
pub fn transcribe_language_code(lang: &str) -> Option<&'static str> {
    match lang {
        "ja" => Some("ja-JP"),
        "en" => Some("en-US"),
        "vi" => Some("vi-VN"),
        _ => None,
    }
}
