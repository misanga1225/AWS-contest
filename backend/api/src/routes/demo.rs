//! デモデータ初期化のルートハンドラ。

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use domain::Resident;
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::services::demo as svc;
use crate::state::AppState;

/// POST /demo-data のボディ (フロア省略時は設定値の全フロア)。
#[derive(Debug, Default, Deserialize)]
pub struct DemoBody {
    #[serde(default)]
    pub floors: Option<Vec<String>>,
}

/// POST /demo-data — 架空の利用者・baseline を投入する (冪等)。
pub async fn seed(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    body: Option<Json<DemoBody>>,
) -> Result<(StatusCode, Json<Vec<Resident>>), ApiError> {
    let floors = body
        .and_then(|Json(b)| b.floors)
        .unwrap_or_else(|| state.config.floors.clone());
    let created = svc::seed(state.repo.as_ref(), &floors).await?;
    Ok((StatusCode::CREATED, Json(created)))
}
