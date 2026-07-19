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
    pub bedrock_model_id: String,
    pub shift: ShiftConfig,
    /// デモデータ初期化やサマリ一括生成の対象フロア。
    pub floors: Vec<String>,
}

impl AppConfig {
    /// env から読み込む。`TABLE_NAME` は必須。シフト時刻は既定 (UTC 00:00-09:00 =
    /// JST 日勤 09:00-18:00 相当) を持つが、実運用では infra が SSM 値を注入する。
    pub fn from_env() -> Result<Self, ConfigError> {
        let table_name = env::var("TABLE_NAME").map_err(|_| ConfigError::Missing("TABLE_NAME"))?;
        // モデル ID は infra が SSM 値を BEDROCK_MODEL_ID として注入する。
        let bedrock_model_id = env::var("BEDROCK_MODEL_ID")
            .unwrap_or_else(|_| "apac.anthropic.claude-3-haiku-20240307-v1:0".to_string());
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
            bedrock_model_id,
            shift,
            floors,
        })
    }
}
