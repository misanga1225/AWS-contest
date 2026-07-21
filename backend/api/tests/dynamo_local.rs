//! DynamoDB Local に対する [`DynamoRepository`] の往復テスト。
//!
//! 実 DynamoDB 相当の serde_dynamo 変換・`begins_with` クエリ・GSI 属性付与を検証する。
//! `DYNAMODB_LOCAL_ENDPOINT` (例: http://localhost:8000) が設定されている時のみ実行し、
//! 無ければスキップする (CI/ローカルで Docker が無くても緑になる)。
//!
//! 起動例: `docker run -p 8000:8000 amazon/dynamodb-local`

use api::repository::Repository;
use api::repository::dynamo::DynamoRepository;
use aws_sdk_dynamodb::Client;
use aws_sdk_dynamodb::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_dynamodb::types::{
    AttributeDefinition, BillingMode, GlobalSecondaryIndex, KeySchemaElement, KeyType, Projection,
    ProjectionType, ScalarAttributeType,
};
use domain::{
    CareRecord, Category, HandoverSummary, Priority, RecordStatus, Resident, ResidentStatus,
    SummaryItem,
};

fn client(endpoint: &str) -> Client {
    let http = aws_smithy_http_client::Builder::new()
        .tls_provider(aws_smithy_http_client::tls::Provider::Rustls(
            aws_smithy_http_client::tls::rustls_provider::CryptoMode::Ring,
        ))
        .build_https();
    let conf = aws_sdk_dynamodb::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("ap-northeast-1"))
        .endpoint_url(endpoint)
        .credentials_provider(Credentials::new("test", "test", None, None, "test"))
        .http_client(http)
        .build();
    Client::from_conf(conf)
}

async fn create_table(client: &Client, table: &str) {
    let attr = |name: &str| {
        AttributeDefinition::builder()
            .attribute_name(name)
            .attribute_type(ScalarAttributeType::S)
            .build()
            .unwrap()
    };
    let key = |name: &str, kt: KeyType| {
        KeySchemaElement::builder()
            .attribute_name(name)
            .key_type(kt)
            .build()
            .unwrap()
    };
    client
        .create_table()
        .table_name(table)
        .attribute_definitions(attr("PK"))
        .attribute_definitions(attr("SK"))
        .attribute_definitions(attr("GSI1PK"))
        .attribute_definitions(attr("GSI1SK"))
        .key_schema(key("PK", KeyType::Hash))
        .key_schema(key("SK", KeyType::Range))
        .global_secondary_indexes(
            GlobalSecondaryIndex::builder()
                .index_name("GSI1")
                .key_schema(key("GSI1PK", KeyType::Hash))
                .key_schema(key("GSI1SK", KeyType::Range))
                .projection(
                    Projection::builder()
                        .projection_type(ProjectionType::All)
                        .build(),
                )
                .build()
                .unwrap(),
        )
        .billing_mode(BillingMode::PayPerRequest)
        .send()
        .await
        .expect("create_table failed");
}

fn sample_resident(floor: &str, id: &str) -> Resident {
    Resident {
        schema_version: 1,
        id: id.to_string(),
        floor: floor.to_string(),
        name: "テスト利用者".to_string(),
        room: format!("{floor}01"),
        baseline: "平常時情報".to_string(),
        created_at: "2026-07-19T00:00:00Z".to_string(),
        status: ResidentStatus::Active,
        discharged_at: None,
    }
}

fn sample_record(floor: &str, id: &str, created_at: &str, status: RecordStatus) -> CareRecord {
    CareRecord {
        schema_version: 1,
        id: id.to_string(),
        floor: floor.to_string(),
        resident_id: "r1".to_string(),
        category: Category::Vitals,
        body_ja: "血圧 130/80".to_string(),
        original_text: "血圧 130/80".to_string(),
        lang: "ja".to_string(),
        verification_text: None,
        status,
        created_by: "staff-1".to_string(),
        created_at: created_at.to_string(),
        approved_by: None,
        approved_at: None,
    }
}

#[tokio::test]
async fn dynamo_local_round_trip() {
    let Ok(endpoint) = std::env::var("DYNAMODB_LOCAL_ENDPOINT") else {
        eprintln!("DYNAMODB_LOCAL_ENDPOINT 未設定のためスキップ");
        return;
    };

    let table = format!("handover-test-{}", ulid_like());
    let client = client(&endpoint);
    create_table(&client, &table).await;
    let repo = DynamoRepository::new(client, table, "GSI1".to_string());

    // 利用者: put → get → list
    let resident = sample_resident("3", "r1");
    repo.put_resident(&resident).await.unwrap();
    assert_eq!(
        repo.get_resident("3", "r1").await.unwrap(),
        Some(resident.clone())
    );
    assert_eq!(repo.list_residents("3").await.unwrap(), vec![resident]);

    // 記録: 2 件 put → list は時系列、get は完全一致
    let r1 = sample_record("3", "01A", "2026-07-19T03:00:00Z", RecordStatus::Draft);
    let r2 = sample_record("3", "01B", "2026-07-19T05:00:00Z", RecordStatus::Approved);
    repo.put_record(&r1).await.unwrap();
    repo.put_record(&r2).await.unwrap();
    let listed = repo.list_records_by_floor("3").await.unwrap();
    assert_eq!(listed.len(), 2);
    // SK は created_at 昇順
    assert_eq!(listed[0].id, "01A");
    assert_eq!(listed[1].id, "01B");
    assert_eq!(
        repo.get_record("3", "2026-07-19T05:00:00Z", "01B")
            .await
            .unwrap(),
        Some(r2)
    );

    // 別フロアは混ざらない
    assert!(repo.list_records_by_floor("9").await.unwrap().is_empty());

    // 条件付き書き込み: draft→approved は許可、承認済みへの再書き込みは Conflict。
    // (Option::None が NULL 属性化されても status 条件で正しく判定できることの実 DB 検証)
    let mut approved = sample_record("3", "01A", "2026-07-19T03:00:00Z", RecordStatus::Approved);
    approved.approved_by = Some("staff-2".to_string());
    approved.approved_at = Some("2026-07-19T06:00:00Z".to_string());
    repo.put_record_if_unapproved(&approved).await.unwrap();
    let err = repo.put_record_if_unapproved(&approved).await.unwrap_err();
    assert!(
        matches!(err, api::repository::RepoError::Conflict),
        "承認済みへの再書き込みは Conflict であるべき: {err:?}"
    );

    // サマリ: put → get → list
    let summary = HandoverSummary {
        schema_version: 1,
        floor: "3".to_string(),
        date: "2026-07-19".to_string(),
        shift: "day".to_string(),
        items: vec![SummaryItem {
            priority: Priority::Attention,
            resident_id: Some("r1".to_string()),
            text: "確認をお願いします".to_string(),
            evidence_record_ids: vec!["01B".to_string()],
        }],
        generated_at: "2026-07-19T09:00:00Z".to_string(),
    };
    repo.put_summary(&summary).await.unwrap();
    assert_eq!(
        repo.get_summary("3", "2026-07-19", "day").await.unwrap(),
        Some(summary.clone())
    );
    assert_eq!(
        repo.list_summaries_by_floor("3").await.unwrap(),
        vec![summary]
    );

    // 削除
    repo.delete_resident("3", "r1").await.unwrap();
    assert_eq!(repo.get_resident("3", "r1").await.unwrap(), None);
}

// テーブル名衝突回避用の簡易ユニーク文字列 (テスト専用)。
fn ulid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{n}")
}
