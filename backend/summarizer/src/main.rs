//! 要約 Lambda のエントリポイント。
//!
//! EventBridge Scheduler のシフト終了トリガ、または手動トリガから起動され、
//! 対象フロア・シフトの横断サマリを生成する。生成ロジックは api クレートの
//! `services::summaries::generate` を再利用する。

use api::config::AppConfig;
use api::services::summaries;
use chrono::{NaiveDate, Utc};
use domain::shift::Shift;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use serde::Deserialize;
use serde_json::{Value, json};

/// スケジューラ / 手動トリガのイベント入力 (すべて任意)。
///
/// 省略時は「現在のシフト」を全設定フロアに対して生成する。
#[derive(Debug, Default, Deserialize)]
struct SummarizerEvent {
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    shift: Option<String>,
    #[serde(default)]
    floors: Option<Vec<String>>,
    /// 既存サマリがあっても再生成する。未指定時は false (冪等・再試行での重複課金を避ける)。
    #[serde(default)]
    force: bool,
}

async fn handler(event: LambdaEvent<Value>) -> Result<Value, Error> {
    let input: SummarizerEvent = match serde_json::from_value(event.payload) {
        Ok(v) => v,
        Err(e) => {
            // 不正なペイロードを黙ってデフォルト値 (現在シフト・全フロア) にフォールバックせず、
            // 意図しない範囲でのサマリ再生成に気付けるよう記録する。
            tracing::warn!(error = %e, "failed to parse summarizer event payload, using defaults");
            SummarizerEvent::default()
        }
    };

    let config = AppConfig::from_env()?;
    let floors = input
        .floors
        .clone()
        .unwrap_or_else(|| config.floors.clone());

    let (date, shift) = resolve_target(&config, input.date.as_deref(), input.shift.as_deref())?;

    let state = api::aws::build_state(config).await;

    let mut generated = Vec::new();
    for floor in &floors {
        match summaries::generate(
            state.repo.as_ref(),
            state.llm.as_ref(),
            &state.config,
            floor,
            date,
            shift,
            input.force,
        )
        .await
        {
            Ok(summary) => {
                tracing::info!(floor = %floor, items = summary.items.len(), "summary generated");
                generated.push(floor.clone());
            }
            // 1 フロアの失敗で全体を止めない (他フロアは生成する)
            Err(e) => tracing::error!(floor = %floor, error = %e, "summary generation failed"),
        }
    }

    Ok(json!({
        "date": date.format("%Y-%m-%d").to_string(),
        "shift": shift.as_str(),
        "generated_floors": generated,
    }))
}

/// イベントの date/shift 指定を解決する。
///
/// スケジューラは `{"shift":"night"}` のように shift だけを渡す (対象日は起動時刻から
/// 導く)。date/shift を独立に解決し、shift だけ指定されたときは「いま終わったシフト」の
/// 対象日を用いる。両方省略時のみ現在シフトにフォールバックする。
fn resolve_target(
    config: &AppConfig,
    date: Option<&str>,
    shift: Option<&str>,
) -> Result<(NaiveDate, Shift), Error> {
    let now = Utc::now();
    let parse_shift =
        |s: &str| Shift::from_str_opt(s).ok_or_else(|| Error::from(format!("不正なshift: {s}")));
    let parse_date = |d: &str| {
        NaiveDate::parse_from_str(d, "%Y-%m-%d")
            .map_err(|_| Error::from(format!("不正なdate: {d}")))
    };

    match (date, shift) {
        (Some(d), Some(s)) => Ok((parse_date(d)?, parse_shift(s)?)),
        // shift のみ: いま終わったシフトの対象日を導く (境界起動を想定)。
        (None, Some(s)) => {
            let shift = parse_shift(s)?;
            Ok((summaries::target_ended_shift(now, shift), shift))
        }
        // date のみ: シフトは現在シフトを採用する (通常来ない補助経路)。
        (Some(d), None) => {
            let (_, shift) = summaries::target_from_now(config, now);
            Ok((parse_date(d)?, shift))
        }
        (None, None) => Ok(summaries::target_from_now(config, now)),
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing::init_default_subscriber();
    run(service_fn(handler)).await
}
