//! ルーティング。ハンドラは薄く保ち、ビジネスロジックは services に委譲する。
//!
//! JWT オーソライザは infra 側で付与し、`/health` を除く全ルートに認証を要求する。
//! ハンドラは [`crate::auth::AuthUser`] で検証済み `sub` を受け取る。

use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post, put};

use crate::state::AppState;

pub mod demo;
pub mod records;
pub mod residents;
pub mod summaries;

/// 全ルートを組み立てる。
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/records", post(records::create).get(records::list))
        .route("/records/{id}/approve", put(records::approve))
        .route("/residents", get(residents::list).post(residents::create))
        .route(
            "/residents/{id}",
            put(residents::update).delete(residents::delete),
        )
        .route("/demo-data", post(demo::seed))
        .route("/summaries", get(summaries::list))
        .route("/summaries/detail", get(summaries::detail))
        .route("/summaries/trigger", post(summaries::trigger))
        .with_state(state)
}

/// オーソライザ不要のヘルスチェック。
async fn health() -> &'static str {
    "ok"
}
