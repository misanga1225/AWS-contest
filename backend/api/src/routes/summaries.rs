//! 横断サマリのルートハンドラ。

use std::sync::Arc;

use axum::Json;
use axum::extract::{Query, State};
use chrono::{NaiveDate, Utc};
use domain::HandoverSummary;
use domain::shift::Shift;
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::services::summaries as svc;
use crate::state::AppState;

/// GET /summaries?floor=
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub floor: String,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<HandoverSummary>>, ApiError> {
    let summaries = svc::list(state.repo.as_ref(), &q.floor).await?;
    Ok(Json(summaries))
}

/// GET /summaries/detail?floor=&date=&shift=
#[derive(Debug, Deserialize)]
pub struct DetailQuery {
    pub floor: String,
    pub date: String,
    pub shift: String,
}

pub async fn detail(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Query(q): Query<DetailQuery>,
) -> Result<Json<HandoverSummary>, ApiError> {
    let shift = Shift::from_str_opt(&q.shift)
        .ok_or_else(|| ApiError::BadRequest(format!("不正なshift: {}", q.shift)))?;
    let summary = svc::get(state.repo.as_ref(), &q.floor, &q.date, shift).await?;
    Ok(Json(summary))
}

/// POST /summaries/trigger のボディ。date/shift 省略時は現在のシフトを対象にする。
#[derive(Debug, Deserialize)]
pub struct TriggerBody {
    pub floor: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub shift: Option<String>,
}

/// POST /summaries/trigger — 手動でサマリ生成する。
pub async fn trigger(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Json(body): Json<TriggerBody>,
) -> Result<Json<HandoverSummary>, ApiError> {
    let (date, shift) = match (body.date.as_deref(), body.shift.as_deref()) {
        (Some(d), Some(s)) => {
            let date = NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .map_err(|_| ApiError::BadRequest(format!("不正なdate: {d}")))?;
            let shift = Shift::from_str_opt(s)
                .ok_or_else(|| ApiError::BadRequest(format!("不正なshift: {s}")))?;
            (date, shift)
        }
        _ => svc::target_from_now(&state.config, Utc::now()),
    };

    let summary = svc::generate(
        state.repo.as_ref(),
        state.llm.as_ref(),
        &state.config,
        &body.floor,
        date,
        shift,
    )
    .await?;
    Ok(Json(summary))
}
