//! 小さな共通ユーティリティ (時刻・ID 生成)。

use chrono::{SecondsFormat, Utc};
use ulid::Ulid;

/// 現在時刻を RFC3339 UTC 文字列で返す (秒精度、末尾 Z)。SK のソート順に使う。
pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// 時系列ソート可能な新規 ID (ULID) を生成する。
pub fn new_id() -> String {
    Ulid::new().to_string()
}
