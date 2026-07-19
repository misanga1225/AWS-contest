//! API 全体のエラー型。ハンドラはこの型を返し、`IntoResponse` で HTTP に変換する。
//! panic はさせず、? 演算子で伝播する。

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::llm::LlmError;
use crate::repository::RepoError;

/// API ハンドラの共通エラー。
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("認証が必要です")]
    Unauthorized,

    #[error("不正なリクエスト: {0}")]
    BadRequest(String),

    #[error("リソースが見つかりません")]
    NotFound,

    #[error("承認済み記録は変更できません")]
    AlreadyApproved,

    #[error("データストアエラー")]
    Repo(#[from] RepoError),

    #[error("LLM 処理エラー")]
    Llm(#[from] LlmError),
}

impl ApiError {
    fn status(&self) -> StatusCode {
        match self {
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::AlreadyApproved => StatusCode::CONFLICT,
            ApiError::Repo(_) | ApiError::Llm(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        // サーバ内部エラーの詳細はクライアントに返さずログにのみ残す
        // (利用者の個人情報は含めない)。
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = %self, "internal error");
        }
        let body = Json(json!({
            "error": self.to_string(),
        }));
        (status, body).into_response()
    }
}
