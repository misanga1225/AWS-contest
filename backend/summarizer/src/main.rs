use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use serde_json::{Value, json};

/// スケルトン段階の空ハンドラ。
/// EventBridge Scheduler / 手動トリガから起動され、サマリ生成を行う予定。
async fn handler(_event: LambdaEvent<Value>) -> Result<Value, Error> {
    Ok(json!({ "status": "ok" }))
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing::init_default_subscriber();

    run(service_fn(handler)).await
}
