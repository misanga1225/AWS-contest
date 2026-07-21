//! 音声アップロード・文字起こしのルートハンドラ (薄く保つ)。
//!
//! 認証は catch-all の JWT オーソライザで担保される。ハンドラは検証済み職員 (`AuthUser`)
//! からのみ呼ばれ、ロジックは [`crate::services::transcribe`] に委譲する。

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::services::transcribe as svc;
use crate::state::AppState;

/// POST /uploads/audio-url のボディ。
#[derive(Debug, Deserialize)]
pub struct UploadUrlBody {
    /// 録音の content-type (例: "audio/webm")。
    pub content_type: String,
    /// 拡張子 (例: "webm")。
    pub ext: String,
}

/// POST /uploads/audio-url の応答。
#[derive(Debug, Serialize)]
pub struct UploadUrlResponse {
    /// S3 へ直接 PUT するためのプリサインド URL。
    pub url: String,
    /// アップロード先キー (次の /transcribe にそのまま渡す)。
    pub key: String,
}

/// POST /uploads/audio-url — 音声アップロード用プリサインド URL を発行する。
pub async fn create_upload_url(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Json(body): Json<UploadUrlBody>,
) -> Result<Json<UploadUrlResponse>, ApiError> {
    let out = svc::create_upload_url(state.storage.as_ref(), &body.content_type, &body.ext).await?;
    Ok(Json(UploadUrlResponse {
        url: out.url,
        key: out.key,
    }))
}

/// POST /transcribe のボディ。
#[derive(Debug, Deserialize)]
pub struct StartBody {
    /// /uploads/audio-url が返したキー。
    pub key: String,
    /// 話した言語 (ja/en/vi)。職員が画面で選ぶ。
    pub lang: String,
}

/// POST /transcribe の応答。
#[derive(Debug, Serialize)]
pub struct StartResponse {
    pub job_name: String,
}

/// POST /transcribe — アップロード済み音声の文字起こしジョブを開始する。
pub async fn start(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Json(body): Json<StartBody>,
) -> Result<Json<StartResponse>, ApiError> {
    let job_name =
        svc::start_transcription(state.transcriber.as_ref(), &body.key, &body.lang).await?;
    Ok(Json(StartResponse { job_name }))
}

/// GET /transcribe/{job} の応答。
///
/// status は "in_progress" | "failed" | "completed"。completed のときのみ text を含む。
#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// GET /transcribe/{job} — 文字起こしの状態を取得し、完了ならテキストを返す。
pub async fn status(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(job): Path<String>,
) -> Result<Json<StatusResponse>, ApiError> {
    let outcome =
        svc::get_transcription(state.transcriber.as_ref(), state.storage.as_ref(), &job).await?;
    let resp = match outcome {
        svc::TranscriptionOutcome::InProgress => StatusResponse {
            status: "in_progress",
            text: None,
        },
        svc::TranscriptionOutcome::Failed => StatusResponse {
            status: "failed",
            text: None,
        },
        svc::TranscriptionOutcome::Completed(text) => StatusResponse {
            status: "completed",
            text: Some(text),
        },
    };
    Ok(Json(resp))
}
