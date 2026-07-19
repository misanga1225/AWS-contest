//! シフト帯の定義と時間窓の計算。
//!
//! シフト時刻はハードコードせず、SSM Parameter Store 由来の設定値
//! ([`ShiftConfig`]) を各バイナリが env から読み込んで渡す。
//! api (記録の一覧フィルタ) と summarizer (シフト終了時の対象記録抽出) で共有する。

use chrono::{DateTime, Duration, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

/// シフト種別。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Shift {
    /// 日勤
    Day,
    /// 夜勤
    Night,
}

impl Shift {
    /// SK やクエリで使う小文字表現 ("day" | "night")。
    pub fn as_str(self) -> &'static str {
        match self {
            Shift::Day => "day",
            Shift::Night => "night",
        }
    }

    /// 文字列から復元する。未知の値は `None`。
    pub fn from_str_opt(s: &str) -> Option<Shift> {
        match s {
            "day" => Some(Shift::Day),
            "night" => Some(Shift::Night),
            _ => None,
        }
    }
}

/// シフト時刻の設定 (UTC 基準の HH:MM)。
///
/// 日勤は `day_start` 以上 `day_end` 未満、夜勤はそれ以外 (`day_end` 以上または
/// 翌 `day_start` 未満) とする。介護現場は 24 時間をこの 2 帯で分割する想定。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShiftConfig {
    pub day_start: NaiveTime,
    pub day_end: NaiveTime,
}

/// シフト設定のパースエラー。
#[derive(Debug, thiserror::Error)]
pub enum ShiftError {
    #[error("シフト時刻の形式が不正です (HH:MM を期待): {0}")]
    InvalidTime(String),
}

impl ShiftConfig {
    /// "HH:MM" 文字列 2 つから設定を作る。
    pub fn from_hhmm(day_start: &str, day_end: &str) -> Result<Self, ShiftError> {
        let parse = |s: &str| {
            NaiveTime::parse_from_str(s, "%H:%M")
                .map_err(|_| ShiftError::InvalidTime(s.to_string()))
        };
        Ok(ShiftConfig {
            day_start: parse(day_start)?,
            day_end: parse(day_end)?,
        })
    }

    /// 指定時刻がどちらのシフト帯かを判定する。
    pub fn shift_at(&self, at: DateTime<Utc>) -> Shift {
        let t = at.time();
        if t >= self.day_start && t < self.day_end {
            Shift::Day
        } else {
            Shift::Night
        }
    }
}

/// あるシフトの時間窓 [start, end)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShiftWindow {
    pub shift: Shift,
    /// 対象日 (YYYY-MM-DD)。夜勤は開始日で表す。
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

impl ShiftWindow {
    /// 対象日 (YYYY-MM-DD) とシフトから時間窓を計算する。
    ///
    /// - 日勤: `date day_start` 〜 `date day_end`
    /// - 夜勤: `date day_end` 〜 翌日 `day_start`
    pub fn for_date(config: &ShiftConfig, date: chrono::NaiveDate, shift: Shift) -> ShiftWindow {
        let at = |d: chrono::NaiveDate, t: NaiveTime| Utc.from_utc_datetime(&d.and_time(t));
        match shift {
            Shift::Day => ShiftWindow {
                shift,
                start: at(date, config.day_start),
                end: at(date, config.day_end),
            },
            Shift::Night => ShiftWindow {
                shift,
                start: at(date, config.day_end),
                end: at(date + Duration::days(1), config.day_start),
            },
        }
    }

    /// この窓に含まれる記録の created_at (RFC3339) かどうか。
    pub fn contains_rfc3339(&self, created_at: &str) -> bool {
        match DateTime::parse_from_rfc3339(created_at) {
            Ok(dt) => {
                let dt = dt.with_timezone(&Utc);
                dt >= self.start && dt < self.end
            }
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> ShiftConfig {
        // 日勤 06:00-21:00、夜勤 21:00-翌06:00 (日跨ぎ) の現実的な設定
        ShiftConfig::from_hhmm("06:00", "21:00").unwrap()
    }

    #[test]
    fn shift_at_classifies() {
        let c = cfg();
        let day = Utc.with_ymd_and_hms(2026, 7, 19, 12, 0, 0).unwrap();
        let evening = Utc.with_ymd_and_hms(2026, 7, 19, 23, 0, 0).unwrap();
        let early = Utc.with_ymd_and_hms(2026, 7, 19, 3, 0, 0).unwrap();
        assert_eq!(c.shift_at(day), Shift::Day);
        assert_eq!(c.shift_at(evening), Shift::Night);
        assert_eq!(c.shift_at(early), Shift::Night);
    }

    #[test]
    fn night_window_crosses_midnight() {
        let c = cfg();
        let date = chrono::NaiveDate::from_ymd_opt(2026, 7, 19).unwrap();
        // 夜勤: 2026-07-19 21:00 〜 2026-07-20 06:00
        let w = ShiftWindow::for_date(&c, date, Shift::Night);
        assert!(w.contains_rfc3339("2026-07-19T22:00:00Z"));
        assert!(w.contains_rfc3339("2026-07-20T05:00:00Z"));
        assert!(!w.contains_rfc3339("2026-07-20T06:00:00Z"));
        assert!(!w.contains_rfc3339("2026-07-19T20:00:00Z"));
    }

    #[test]
    fn day_window_bounds() {
        let c = cfg();
        let date = chrono::NaiveDate::from_ymd_opt(2026, 7, 19).unwrap();
        let w = ShiftWindow::for_date(&c, date, Shift::Day);
        assert!(w.contains_rfc3339("2026-07-19T12:00:00Z"));
        assert!(w.contains_rfc3339("2026-07-19T06:00:00Z"));
        assert!(!w.contains_rfc3339("2026-07-19T21:00:00Z"));
        assert!(!w.contains_rfc3339("2026-07-19T05:59:59Z"));
    }

    #[test]
    fn invalid_time_errors() {
        assert!(ShiftConfig::from_hhmm("9am", "18:00").is_err());
    }
}
