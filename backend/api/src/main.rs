use axum::{Router, routing::get};
use lambda_http::{Error, run, tracing};

/// デプロイ疎通確認用ヘルスチェック。オーソライザ不要の唯一のルート。
async fn health() -> &'static str {
    "ok"
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing::init_default_subscriber();

    let app = Router::new().route("/health", get(health));

    run(app).await
}
