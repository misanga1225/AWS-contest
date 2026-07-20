//! 利用者マスタのルートハンドラ。

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use domain::Resident;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::services::residents as svc;
use crate::state::AppState;

/// GET/DELETE で使うフロア指定クエリ。
#[derive(Debug, Deserialize)]
pub struct FloorQuery {
    pub floor: String,
}

/// 一覧取得クエリ。退所者は既定で除外する。
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub floor: String,
    #[serde(default)]
    pub include_discharged: bool,
}

/// DELETE の結果。物理削除されたか退所扱いになったかを画面に伝える。
#[derive(Debug, Serialize)]
pub struct DeleteResponse {
    pub outcome: &'static str,
}

impl From<svc::DeleteOutcome> for DeleteResponse {
    fn from(o: svc::DeleteOutcome) -> Self {
        let outcome = match o {
            svc::DeleteOutcome::Deleted => "deleted",
            svc::DeleteOutcome::Discharged => "discharged",
        };
        DeleteResponse { outcome }
    }
}

/// 作成・更新のボディ。
#[derive(Debug, Deserialize)]
pub struct ResidentBody {
    pub floor: String,
    pub name: String,
    #[serde(default)]
    pub room: String,
    #[serde(default)]
    pub baseline: String,
}

impl From<ResidentBody> for svc::ResidentInput {
    fn from(b: ResidentBody) -> Self {
        svc::ResidentInput {
            floor: b.floor,
            name: b.name,
            room: b.room,
            baseline: b.baseline,
        }
    }
}

/// GET /residents?floor=&include_discharged=
pub async fn list(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<Resident>>, ApiError> {
    let residents = svc::list(state.repo.as_ref(), &q.floor, q.include_discharged).await?;
    Ok(Json(residents))
}

/// POST /residents
pub async fn create(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Json(body): Json<ResidentBody>,
) -> Result<(StatusCode, Json<Resident>), ApiError> {
    let resident = svc::create(state.repo.as_ref(), body.into()).await?;
    Ok((StatusCode::CREATED, Json(resident)))
}

/// PUT /residents/{id}
pub async fn update(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<ResidentBody>,
) -> Result<Json<Resident>, ApiError> {
    let floor = body.floor.clone();
    let resident = svc::update(state.repo.as_ref(), &floor, &id, body.into()).await?;
    Ok(Json(resident))
}

/// DELETE /residents/{id}?floor=
///
/// 記録がある利用者は物理削除せず退所扱いになるため、204 ではなく結果を JSON で返す。
pub async fn delete(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<FloorQuery>,
) -> Result<Json<DeleteResponse>, ApiError> {
    let outcome = svc::delete(state.repo.as_ref(), &q.floor, &id).await?;
    Ok(Json(outcome.into()))
}
