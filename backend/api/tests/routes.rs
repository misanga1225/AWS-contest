//! ルートの結合テスト。
//!
//! 実 AWS に依存せず、InMemoryRepository + FakeLlm で axum ルータを tower oneshot に
//! かけ、投稿→承認→サマリ生成の一連の縦割りを検証する。認証・エラー経路も確認する。

use std::sync::Arc;

use api::AppState;
use api::auth::AuthUser;
use api::config::AppConfig;
use api::llm::fake::FakeLlm;
use api::media::fake::{FAKE_TRANSCRIPT, FakeStorage, FakeTranscriber};
use api::repository::memory::InMemoryRepository;
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use domain::shift::ShiftConfig;
use domain::{CareRecord, HandoverSummary, RecordStatus, Resident, ResidentStatus};
use serde_json::{Value, json};
use tower::ServiceExt;

fn test_state() -> Arc<AppState> {
    let config = AppConfig {
        table_name: "test-table".to_string(),
        index_name: "GSI1".to_string(),
        bedrock_model_id: "fake-model".to_string(),
        audio_bucket: "test-audio-bucket".to_string(),
        shift: ShiftConfig::from_hhmm("00:00", "23:59").unwrap(), // 日勤に収める
        floors: vec!["1".to_string(), "2".to_string(), "3".to_string()],
    };
    AppState::new(
        Arc::new(InMemoryRepository::new()),
        Arc::new(FakeLlm::new()),
        Arc::new(FakeStorage::new()),
        Arc::new(FakeTranscriber::new()),
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

    // 有効な利用者で draft を作る
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/residents",
            Some(json!({ "floor": "2", "name": "承認 テスト", "room": "201" })),
        ))
        .await
        .unwrap();
    let resident: Resident = body_json(resp).await;

    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/records",
            Some(json!({ "floor": "2", "resident_id": resident.id, "text": "特記なし" })),
        ))
        .await
        .unwrap();
    let draft: CareRecord = body_json(resp).await;

    // 承認時に実在しない利用者へ差し替え → 400
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

/// 利用者未選択の投稿は LLM を呼ぶ前に 400 で弾く。
/// (誰の記録かを LLM に推定させないため。無駄なトークン消費も避ける)
#[tokio::test]
async fn create_record_requires_resident() {
    let app = app();

    // resident_id が空文字 → 400
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/records",
            Some(json!({ "floor": "1", "resident_id": "", "text": "昼食を全量摂取" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // resident_id 自体が無い → 400 (デシリアライズで弾かれる)
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/records",
            Some(json!({ "floor": "1", "text": "昼食を全量摂取" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 記録は 1 件も作られていない
    let resp = app
        .clone()
        .oneshot(authed("GET", "/records?floor=1", None))
        .await
        .unwrap();
    let records: Vec<CareRecord> = body_json(resp).await;
    assert!(records.is_empty(), "検証失敗時に draft を作ってはいけない");
}

/// 母語(vi)入力は draft に逆翻訳の確認用テキスト(verification_text)を持ち、
/// 日本語(ja)入力は持たない。承認画面の human-in-the-loop 照合の土台になる。
#[tokio::test]
async fn draft_carries_verification_text_for_non_japanese() {
    let app = app();

    // 利用者を用意
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/residents",
            Some(json!({ "floor": "1", "name": "逆翻訳 テスト", "room": "111" })),
        ))
        .await
        .unwrap();
    let resident: Resident = body_json(resp).await;

    // ベトナム語(ASCII外・かな無し)の原文 → FakeLlm が verification_text を付ける
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/records",
            Some(json!({
                "floor": "1",
                "resident_id": resident.id,
                "text": "Ăn hết bữa trưa"
            })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let vi_draft: CareRecord = body_json(resp).await;
    assert_eq!(vi_draft.lang, "vi");
    assert!(
        vi_draft.verification_text.is_some(),
        "母語(非ja)の draft は確認用逆翻訳を持つ"
    );

    // 日本語の原文 → verification_text は None
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/records",
            Some(json!({
                "floor": "1",
                "resident_id": resident.id,
                "text": "昼食を全量摂取。"
            })),
        ))
        .await
        .unwrap();
    let ja_draft: CareRecord = body_json(resp).await;
    assert_eq!(ja_draft.lang, "ja");
    assert!(
        ja_draft.verification_text.is_none(),
        "日本語入力に逆翻訳は不要"
    );
}

/// 音声アップロード〜文字起こしの縦割り: URL発行 → ジョブ開始 → 完了でテキスト取得。
#[tokio::test]
async fn transcribe_flow_upload_start_poll() {
    let app = app();

    // 1. プリサインド URL 発行
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/uploads/audio-url",
            Some(json!({ "content_type": "audio/webm", "ext": "webm" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let upload: Value = body_json(resp).await;
    let key = upload["key"].as_str().unwrap().to_string();
    assert!(key.starts_with("audio/"), "キーは audio/ 配下");
    assert!(upload["url"].as_str().unwrap().starts_with("https://"));

    // 2. 文字起こしジョブ開始
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/transcribe",
            Some(json!({ "key": key, "lang": "ja" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let started: Value = body_json(resp).await;
    let job = started["job_name"].as_str().unwrap().to_string();
    assert!(job.starts_with("wabisuke-"));

    // 3. 状態取得 → FakeTranscriber は即完了しテキストを返す
    let resp = app
        .clone()
        .oneshot(authed("GET", &format!("/transcribe/{job}"), None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let status: Value = body_json(resp).await;
    assert_eq!(status["status"], "completed");
    assert_eq!(status["text"], FAKE_TRANSCRIPT);
}

/// 未対応の音声形式・不正キー・不正言語は 400 で弾く。
#[tokio::test]
async fn transcribe_rejects_bad_input() {
    let app = app();

    // 未対応 content-type
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/uploads/audio-url",
            Some(json!({ "content_type": "application/zip", "ext": "zip" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 不正キー (パストラバーサル)
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/transcribe",
            Some(json!({ "key": "audio/../secret.webm", "lang": "ja" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 未対応言語
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/transcribe",
            Some(json!({ "key": "audio/01HXABC.webm", "lang": "fr" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 不正ジョブ名
    let resp = app
        .clone()
        .oneshot(authed("GET", "/transcribe/not-a-wabisuke-job", None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

/// 実在しない利用者を指定した投稿も 400。
#[tokio::test]
async fn create_record_rejects_unknown_resident() {
    let resp = app()
        .oneshot(authed(
            "POST",
            "/records",
            Some(json!({
                "floor": "1",
                "resident_id": "does-not-exist",
                "text": "昼食を全量摂取"
            })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

/// 記録が無い利用者 (誤登録・テストデータ) は物理削除される。
#[tokio::test]
async fn delete_without_records_removes_resident() {
    let app = app();

    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/residents",
            Some(json!({ "floor": "1", "name": "誤登録 太郎", "room": "101" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let resident: Resident = body_json(resp).await;
    assert_eq!(resident.status, ResidentStatus::Active);

    let resp = app
        .clone()
        .oneshot(authed(
            "DELETE",
            &format!("/residents/{}?floor=1", resident.id),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = body_json(resp).await;
    assert_eq!(body["outcome"], "deleted");

    // 退所者を含めても出てこない = 物理削除されている
    let resp = app
        .clone()
        .oneshot(authed(
            "GET",
            "/residents?floor=1&include_discharged=true",
            None,
        ))
        .await
        .unwrap();
    let listed: Vec<Resident> = body_json(resp).await;
    assert!(listed.is_empty(), "記録が無い利用者は物理削除される");
}

/// 記録がある利用者は物理削除されず退所扱いになり、記録は保存されたまま残る。
/// (法定保存義務のある記録が「誰の記録か分からない」孤児状態になるのを防ぐ)
#[tokio::test]
async fn delete_with_records_discharges_and_keeps_records() {
    let app = app();

    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/residents",
            Some(json!({ "floor": "1", "name": "在籍 花子", "room": "102" })),
        ))
        .await
        .unwrap();
    let resident: Resident = body_json(resp).await;

    // 記録を1件作る (draft のままでも記録は存在する)
    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/records",
            Some(json!({
                "floor": "1",
                "resident_id": resident.id,
                "text": "昼食を全量摂取"
            })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let record: CareRecord = body_json(resp).await;

    // 削除要求 → 退所扱い
    let resp = app
        .clone()
        .oneshot(authed(
            "DELETE",
            &format!("/residents/{}?floor=1", resident.id),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = body_json(resp).await;
    assert_eq!(body["outcome"], "discharged");

    // 既定の一覧からは外れる
    let resp = app
        .clone()
        .oneshot(authed("GET", "/residents?floor=1", None))
        .await
        .unwrap();
    let active: Vec<Resident> = body_json(resp).await;
    assert!(active.is_empty(), "退所者は既定の一覧に出ない");

    // include_discharged=true では取得でき、記録の参照先を解決できる
    let resp = app
        .clone()
        .oneshot(authed(
            "GET",
            "/residents?floor=1&include_discharged=true",
            None,
        ))
        .await
        .unwrap();
    let all: Vec<Resident> = body_json(resp).await;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, resident.id);
    assert_eq!(all[0].status, ResidentStatus::Discharged);
    assert!(all[0].discharged_at.is_some());

    // 記録は消えていない
    let resp = app
        .clone()
        .oneshot(authed("GET", "/records?floor=1", None))
        .await
        .unwrap();
    let records: Vec<CareRecord> = body_json(resp).await;
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].id, record.id);
    assert_eq!(records[0].resident_id, resident.id);
}

/// 退所した利用者を更新しても在籍状態は戻らない (更新 API で状態を変えられない)。
#[tokio::test]
async fn update_does_not_resurrect_discharged_resident() {
    let app = app();

    let resp = app
        .clone()
        .oneshot(authed(
            "POST",
            "/residents",
            Some(json!({ "floor": "1", "name": "退所 次郎", "room": "103" })),
        ))
        .await
        .unwrap();
    let resident: Resident = body_json(resp).await;

    app.clone()
        .oneshot(authed(
            "POST",
            "/records",
            Some(json!({ "floor": "1", "resident_id": resident.id, "text": "特記なし" })),
        ))
        .await
        .unwrap();
    app.clone()
        .oneshot(authed(
            "DELETE",
            &format!("/residents/{}?floor=1", resident.id),
            None,
        ))
        .await
        .unwrap();

    let resp = app
        .clone()
        .oneshot(authed(
            "PUT",
            &format!("/residents/{}", resident.id),
            Some(json!({ "floor": "1", "name": "退所 次郎", "room": "104" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated: Resident = body_json(resp).await;
    assert_eq!(updated.room, "104", "居室は更新される");
    assert_eq!(
        updated.status,
        ResidentStatus::Discharged,
        "更新 API では在籍状態を戻せない"
    );
}

/// 存在しない利用者の削除は 404。
#[tokio::test]
async fn delete_unknown_resident_is_not_found() {
    let resp = app()
        .oneshot(authed("DELETE", "/residents/does-not-exist?floor=1", None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}
