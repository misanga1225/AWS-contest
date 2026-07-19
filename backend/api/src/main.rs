//! API Lambda のエントリポイント。設定を env から読み、AppState を構築して axum を起動する。

use lambda_http::{Error, run, tracing};

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing::init_default_subscriber();

    let config = api::config::AppConfig::from_env()?;
    let state = api::aws::build_state(config).await;
    let app = api::router(state);

    run(app).await
}
