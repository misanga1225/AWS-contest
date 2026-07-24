//! ケア記録のルートハンドラ。

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use chrono::NaiveDate;
use domain::shift::Shift;
use domain::{CareRecord, Category, RecordStatus};
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::services::records as svc;
use crate::state::AppState;

/// POST /records のボディ。
#[derive(Debug, Deserialize)]
pub struct CreateBody {
    pub floor: String,
    /// 対象利用者。必須 (LLM に推定させない)。
    /// 欠落時も serde で空文字にし、services 層の検証で 400 + 明確なメッセージを返す
    /// (axum の JSON 拒否による 422 だと理由が伝わらないため)。
    #[serde(default)]
    pub resident_id: String,
    pub text: String,
}

/// POST /records — 母語入力を LLM 構造化し draft を返す。
pub async fn create(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<CreateBody>,
) -> Result<Json<CareRecord>, ApiError> {
    let record = svc::create_draft(
        state.repo.as_ref(),
        state.llm.as_ref(),
        svc::CreateDraft {
            floor: body.floor,
            resident_id: body.resident_id,
            text: body.text,
            created_by: user.0,
        },
    )
    .await?;
    Ok(Json(record))
}

/// PUT /records/{id}/approve のボディ。
#[derive(Debug, Deserialize)]
pub struct ApproveBody {
    pub floor: String,
    pub created_at: String,
    pub resident_id: String,
    pub category: Category,
    pub body_ja: String,
}

/// PUT /records/{id}/approve — 職員が修正後の値で承認確定する。
pub async fn approve(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<ApproveBody>,
) -> Result<Json<CareRecord>, ApiError> {
    let record = svc::approve(
        state.repo.as_ref(),
        svc::ApproveInput {
            id,
            floor: body.floor,
            created_at: body.created_at,
            resident_id: body.resident_id,
            category: body.category,
            body_ja: body.body_ja,
            approved_by: user.0,
        },
    )
    .await?;
    Ok(Json(record))
}

/// DELETE /records/{id}?floor=&created_at= のクエリ。
#[derive(Debug, Deserialize)]
pub struct DeleteQuery {
    pub floor: String,
    pub created_at: String,
}

/// DELETE /records/{id}?floor=&created_at= — 下書きを削除する (承認済みは削除不可)。
pub async fn delete(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<DeleteQuery>,
) -> Result<StatusCode, ApiError> {
    svc::delete_draft(state.repo.as_ref(), &q.floor, &q.created_at, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /records のクエリ。
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub floor: String,
    #[serde(default)]
    pub shift: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

/// GET /records?floor=&shift=&date=&status= — 条件に合う記録を新しい順に返す。
pub async fn list(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<CareRecord>>, ApiError> {
    let shift = match q.shift.as_deref() {
        Some(s) => Some(
            Shift::from_str_opt(s)
                .ok_or_else(|| ApiError::BadRequest(format!("不正なshift: {s}")))?,
        ),
        None => None,
    };
    let date = match q.date.as_deref() {
        Some(d) => Some(
            NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .map_err(|_| ApiError::BadRequest(format!("不正なdate: {d}")))?,
        ),
        None => None,
    };
    let status = match q.status.as_deref() {
        Some("draft") => Some(RecordStatus::Draft),
        Some("approved") => Some(RecordStatus::Approved),
        Some(other) => return Err(ApiError::BadRequest(format!("不正なstatus: {other}"))),
        None => None,
    };

    let records = svc::list(
        state.repo.as_ref(),
        &state.config,
        svc::ListFilter {
            floor: q.floor,
            shift,
            date,
            status,
        },
    )
    .await?;
    Ok(Json(records))
}
