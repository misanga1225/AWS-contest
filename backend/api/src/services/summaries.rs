//! 横断申し送りサマリの生成・取得。
//!
//! シフト分の承認済み記録と各利用者の平常時情報から、優先度付きサマリを LLM で生成する。
//! このロジックは summarizer クレート (EventBridge Scheduler トリガ) からも
//! api をライブラリとして再利用する。

use chrono::{DateTime, Duration, NaiveDate, Utc};
use domain::shift::{Shift, ShiftWindow};
use domain::{HandoverSummary, RecordStatus};

use crate::config::AppConfig;
use crate::error::ApiError;
use crate::llm::{Llm, RecordBrief, ResidentBaseline, SummarizeRequest};
use crate::repository::Repository;
use crate::util::now_rfc3339;

/// 指定フロア・日付・シフトのサマリを生成して保存する。
///
/// `force=false` かつ既存のサマリがあれば再生成せずそれを返す(冪等)。
/// Bedrock 呼び出しの濫用・重複課金(手動トリガの連打やスケジューラの再試行)を防ぐため。
pub async fn generate(
    repo: &dyn Repository,
    llm: &dyn Llm,
    config: &AppConfig,
    floor: &str,
    date: NaiveDate,
    shift: Shift,
    force: bool,
) -> Result<HandoverSummary, ApiError> {
    if !force {
        let date_str = date.format("%Y-%m-%d").to_string();
        if let Some(existing) = repo.get_summary(floor, &date_str, shift.as_str()).await? {
            return Ok(existing);
        }
    }

    let window = ShiftWindow::for_date(&config.shift, date, shift);

    // 承認済み かつ シフト窓内の記録のみ対象
    let records: Vec<RecordBrief> = repo
        .list_records_by_floor(floor)
        .await?
        .into_iter()
        .filter(|r| r.status == RecordStatus::Approved && window.contains_rfc3339(&r.created_at))
        .map(|r| RecordBrief {
            id: r.id,
            resident_id: r.resident_id,
            category: r.category,
            body_ja: r.body_ja,
            created_at: r.created_at,
        })
        .collect();

    let residents: Vec<ResidentBaseline> = repo
        .list_residents(floor)
        .await?
        .into_iter()
        .map(|r| ResidentBaseline {
            id: r.id,
            baseline: r.baseline,
        })
        .collect();

    let items = llm
        .summarize(SummarizeRequest {
            floor: floor.to_string(),
            shift: shift.as_str().to_string(),
            records,
            residents,
        })
        .await?;

    let summary = HandoverSummary {
        schema_version: domain::SCHEMA_VERSION,
        floor: floor.to_string(),
        date: date.format("%Y-%m-%d").to_string(),
        shift: shift.as_str().to_string(),
        items,
        generated_at: now_rfc3339(),
    };
    repo.put_summary(&summary).await?;
    Ok(summary)
}

/// フロアのサマリ一覧を新しい順に返す。
pub async fn list(repo: &dyn Repository, floor: &str) -> Result<Vec<HandoverSummary>, ApiError> {
    let mut summaries = repo.list_summaries_by_floor(floor).await?;
    summaries.sort_by(|a, b| b.generated_at.cmp(&a.generated_at));
    Ok(summaries)
}

/// 特定日・シフトのサマリを取得する。
pub async fn get(
    repo: &dyn Repository,
    floor: &str,
    date: &str,
    shift: Shift,
) -> Result<HandoverSummary, ApiError> {
    repo.get_summary(floor, date, shift.as_str())
        .await?
        .ok_or(ApiError::NotFound)
}

/// 「シフト終了時刻に起動し、いま終わったシフト」を要約するときの対象日を求める。
///
/// スケジューラはシフト終了(day_end / 翌 day_start)に起動する。`target_from_now` は
/// *now が属する* シフトを返すため、境界時刻ではこれから始まるシフト側に倒れてしまい、
/// 直前に終わったシフトを取り逃す。ここでは終了したシフトの対象日を返す:
/// - 日勤: 窓 `[date day_start, date day_end)` は当日で完結 → 対象日 = now の日付
/// - 夜勤: 窓 `[date day_end, (date+1) day_start)` は翌 day_start(≈now) に終わる
///   → 対象日 = now の前日
///
/// day_start / day_end の具体値に依存せず、境界起動であればどの設定でも成立する。
pub fn target_ended_shift(now: DateTime<Utc>, shift: Shift) -> NaiveDate {
    match shift {
        Shift::Day => now.date_naive(),
        Shift::Night => (now - Duration::days(1)).date_naive(),
    }
}

/// 現在時刻が属するシフトの (対象日, シフト) を求める。
///
/// 夜勤は日付をまたぐため、早朝 (日勤開始前) は前日を対象日とする。
pub fn target_from_now(config: &AppConfig, now: DateTime<Utc>) -> (NaiveDate, Shift) {
    let shift = config.shift.shift_at(now);
    let date = match shift {
        Shift::Day => now.date_naive(),
        Shift::Night => {
            if now.time() < config.shift.day_start {
                (now - Duration::days(1)).date_naive()
            } else {
                now.date_naive()
            }
        }
    };
    (date, shift)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn ended_day_shift_targets_current_date() {
        // 日勤終了(day_end=09:00Z)に起動 → 当日の日勤を対象にする
        let now = Utc.with_ymd_and_hms(2026, 7, 22, 9, 0, 0).unwrap();
        assert_eq!(
            target_ended_shift(now, Shift::Day),
            NaiveDate::from_ymd_opt(2026, 7, 22).unwrap()
        );
    }

    #[test]
    fn ended_night_shift_targets_previous_date() {
        // 夜勤終了(翌 day_start=00:00Z)に起動 → 前日の夜勤(日跨ぎ)を対象にする
        let now = Utc.with_ymd_and_hms(2026, 7, 22, 0, 0, 0).unwrap();
        assert_eq!(
            target_ended_shift(now, Shift::Night),
            NaiveDate::from_ymd_opt(2026, 7, 21).unwrap()
        );
    }

    #[test]
    fn ended_night_shift_holds_across_arbitrary_day_start() {
        // day_start が 06:00Z の設定でも、夜勤終了(翌06:00Z)起動なら前日が対象。
        let now = Utc.with_ymd_and_hms(2026, 7, 22, 6, 0, 0).unwrap();
        assert_eq!(
            target_ended_shift(now, Shift::Night),
            NaiveDate::from_ymd_opt(2026, 7, 21).unwrap()
        );
    }
}
