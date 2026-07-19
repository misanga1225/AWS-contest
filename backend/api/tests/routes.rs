//! ルートの結合テスト。
//!
//! 実 AWS に依存せず、InMemoryRepository + FakeLlm で axum ルータを tower oneshot に
//! かけ、投稿→承認→サマリ生成の一連の縦割りを検証する。認証・エラー経路も確認する。

use std::sync::Arc;

use api::AppState;
use api::auth::AuthUser;
use api::config::AppConfig;
use api::llm::fake::FakeLlm;
use api::repository::memory::InMemoryRepository;
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use domain::shift::ShiftConfig;
use domain::{CareRecord, HandoverSummary, RecordStatus, Resident};
use serde_json::{Value, json};
use tower::ServiceExt;

fn test_state() -> Arc<AppState> {
    let config = AppConfig {
        table_name: "test-table".to_string(),
        bedrock_model_id: "fake-model".to_string(),
        shift: ShiftConfig::from_hhmm("00:00", "23:59").unwrap(), // 日勤に収める
        floors: vec!["1".to_string(), "2".to_string(), "3".to_string()],
    };
    AppState::new(
        Arc::new(InMemoryRepository::new()),
        Arc::new(FakeLlm::new()),
        config,
    )
}

/// 新しい state (空データ) のルータを作る。テストごとに独立させる。
fn app() -> Router {
    api::router(test_state())
}

/// 認証済みリクエスト (AuthUser 拡張を注入)。拡張はクライアントから設定不可のため安全。
fn authed(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
    let body = match body {
        Some(v) => Body::from(serde_json::to_vec(&v).unwrap()),
        None => Body::empty(),
    };
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(body)
        .unwrap();
    req.extensions_mut()
        .insert(AuthUser("staff-sub-123".to_string()));
    req
}

async fn body_json<T: serde::de::DeserializeOwned>(resp: axum::response::Response) -> T {
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn health_is_public() {
    let resp = app()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn protected_route_requires_auth() {
    // AuthUser 拡張なし = 認証情報なし → 401
    let resp = app()
        .oneshot(
            Request::builder()
                .uri("/residents?floor=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn full_flow_demo_post_approve_summarize() {
    let app = app();

    // 1. デモデータ初期化
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/demo-data",
            Some(json!({ "floors": ["1"] })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let residents: Vec<Resident> = body_json(resp).await;
    assert_eq!(residents.len(), 4);
    let resident_id = residents[0].id.clone();

    // 2. 利用者一覧
    let resp = app
        .clone()
        .oneshot(authed("GET", "/residents?floor=1", None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed: Vec<Resident> = body_json(resp).await;
    assert_eq!(listed.len(), 4);

    // 3. ケアメモ投稿 → LLM 構造化 draft
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/records",
            Some(json!({
                "floor": "1",
                "resident_id": resident_id,
                "text": "昼食を全量摂取。水分もよく摂れている。"
            })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let draft: CareRecord = body_json(resp).await;
    assert_eq!(draft.status, RecordStatus::Draft);
    assert_eq!(draft.created_by, "staff-sub-123");
    assert_eq!(
        draft.original_text,
        "昼食を全量摂取。水分もよく摂れている。"
    );
    assert!(draft.approved_at.is_none());

    // 4. 承認 (職員が確認・修正して確定)
    let resp = app
        .clone()
        .oneshot(authed(
            "PUT",
            &format!("/records/{}/approve", draft.id),
            Some(json!({
                "floor": "1",
                "created_at": draft.created_at,
                "resident_id": resident_id,
                "category": draft.category,
                "body_ja": draft.body_ja
            })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let approved: CareRecord = body_json(resp).await;
    assert_eq!(approved.status, RecordStatus::Approved);
    assert_eq!(approved.approved_by.as_deref(), Some("staff-sub-123"));
    assert!(approved.approved_at.is_some());

    // 5. 承認済み記録の一覧
    let resp = app
        .clone()
        .oneshot(authed("GET", "/records?floor=1&status=approved", None))
        .await
        .unwrap();
    let approved_list: Vec<CareRecord> = body_json(resp).await;
    assert_eq!(approved_list.len(), 1);

    // 6. 二重承認は拒否 (承認済みの上書き禁止)
    let resp = app
        .clone()
        .oneshot(authed(
            "PUT",
            &format!("/records/{}/approve", draft.id),
            Some(json!({
                "floor": "1",
                "created_at": draft.created_at,
                "resident_id": resident_id,
                "category": draft.category,
                "body_ja": draft.body_ja
            })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);

    // 7. サマリ手動生成
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/summaries/trigger",
            Some(json!({ "floor": "1", "date": today(), "shift": "day" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let summary: HandoverSummary = body_json(resp).await;
    assert_eq!(summary.floor, "1");
    assert!(!summary.items.is_empty());

    // 8. サマリ一覧
    let resp = app
        .clone()
        .oneshot(authed("GET", "/summaries?floor=1", None))
        .await
        .unwrap();
    let summaries: Vec<HandoverSummary> = body_json(resp).await;
    assert_eq!(summaries.len(), 1);
}

#[tokio::test]
async fn approve_rejects_unknown_resident() {
    let app = app();
    // draft を作成 (resident_id 明示なし → FakeLlm 推定も無いので空)
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/records",
            Some(json!({ "floor": "2", "text": "特記なし" })),
        ))
        .await
        .unwrap();
    let draft: CareRecord = body_json(resp).await;

    // 実在しない利用者で承認 → 400
    let resp = app
        .clone()
        .oneshot(authed(
            "PUT",
            &format!("/records/{}/approve", draft.id),
            Some(json!({
                "floor": "2",
                "created_at": draft.created_at,
                "resident_id": "does-not-exist",
                "category": "note",
                "body_ja": "特記なし"
            })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}
