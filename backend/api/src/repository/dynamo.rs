//! DynamoDB 単一テーブルへの [`Repository`] 実装。
//!
//! domain 型 ↔ アイテムの変換は serde_dynamo で行い、複合キー属性 (PK/SK/GSI1) だけを
//! 付加する。取得は Query + `begins_with`。Scan はここでは行わない。

use std::collections::HashMap;

use async_trait::async_trait;
use aws_sdk_dynamodb::Client;
use aws_sdk_dynamodb::types::AttributeValue;
use domain::{CareRecord, HandoverSummary, Resident, keys};
use serde::Serialize;
use serde::de::DeserializeOwned;

use super::{RepoError, Repository};

/// DynamoDB 実装。
pub struct DynamoRepository {
    client: Client,
    table: String,
    /// 利用者別時系列 GSI の名前 (infra が env 経由で注入)。
    index: String,
}

impl DynamoRepository {
    pub fn new(client: Client, table: String, index: String) -> Self {
        Self {
            client,
            table,
            index,
        }
    }

    /// domain 値をアイテム化し、キー属性を付加して put する。
    async fn put_with_keys<T: Serialize>(
        &self,
        value: &T,
        keys: Vec<(&str, String)>,
    ) -> Result<(), RepoError> {
        let mut item: HashMap<String, AttributeValue> =
            serde_dynamo::to_item(value).map_err(|e| RepoError::Serde(e.to_string()))?;
        for (k, v) in keys {
            item.insert(k.to_string(), AttributeValue::S(v));
        }
        self.client
            .put_item()
            .table_name(&self.table)
            .set_item(Some(item))
            .send()
            .await
            .map_err(|e| RepoError::Dynamo(e.to_string()))?;
        Ok(())
    }

    /// PK+SK 完全一致で 1 件取得する。
    async fn get_one<T: DeserializeOwned>(
        &self,
        pk: String,
        sk: String,
    ) -> Result<Option<T>, RepoError> {
        let resp = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("PK", AttributeValue::S(pk))
            .key("SK", AttributeValue::S(sk))
            .send()
            .await
            .map_err(|e| RepoError::Dynamo(e.to_string()))?;
        match resp.item {
            Some(item) => {
                let v =
                    serde_dynamo::from_item(item).map_err(|e| RepoError::Serde(e.to_string()))?;
                Ok(Some(v))
            }
            None => Ok(None),
        }
    }

    /// PK 一致かつ SK が `prefix` で始まる項目を全ページ取得する。
    async fn query_begins_with<T: DeserializeOwned>(
        &self,
        pk: String,
        prefix: &str,
    ) -> Result<Vec<T>, RepoError> {
        let mut out = Vec::new();
        let mut start_key: Option<HashMap<String, AttributeValue>> = None;
        loop {
            let resp = self
                .client
                .query()
                .table_name(&self.table)
                .key_condition_expression("PK = :pk AND begins_with(SK, :sk)")
                .expression_attribute_values(":pk", AttributeValue::S(pk.clone()))
                .expression_attribute_values(":sk", AttributeValue::S(prefix.to_string()))
                .set_exclusive_start_key(start_key)
                .send()
                .await
                .map_err(|e| RepoError::Dynamo(e.to_string()))?;

            for item in resp.items.unwrap_or_default() {
                let v =
                    serde_dynamo::from_item(item).map_err(|e| RepoError::Serde(e.to_string()))?;
                out.push(v);
            }

            match resp.last_evaluated_key {
                Some(k) if !k.is_empty() => start_key = Some(k),
                _ => break,
            }
        }
        Ok(out)
    }
}

#[async_trait]
impl Repository for DynamoRepository {
    async fn put_record(&self, rec: &CareRecord) -> Result<(), RepoError> {
        let sk = keys::record_sk(&rec.created_at, &rec.id);
        self.put_with_keys(
            rec,
            vec![
                ("PK", keys::floor_pk(&rec.floor)),
                ("SK", sk.clone()),
                ("GSI1PK", keys::resident_gsi1_pk(&rec.resident_id)),
                ("GSI1SK", sk),
            ],
        )
        .await
    }

    async fn put_record_if_unapproved(&self, rec: &CareRecord) -> Result<(), RepoError> {
        let sk = keys::record_sk(&rec.created_at, &rec.id);
        let mut item: HashMap<String, AttributeValue> =
            serde_dynamo::to_item(rec).map_err(|e| RepoError::Serde(e.to_string()))?;
        item.insert(
            "PK".to_string(),
            AttributeValue::S(keys::floor_pk(&rec.floor)),
        );
        item.insert("SK".to_string(), AttributeValue::S(sk.clone()));
        item.insert(
            "GSI1PK".to_string(),
            AttributeValue::S(keys::resident_gsi1_pk(&rec.resident_id)),
        );
        item.insert("GSI1SK".to_string(), AttributeValue::S(sk));

        // 既存が無い(新規)か、既存の status が approved でない場合のみ書き込む。
        // (None も NULL 属性として保存されるため attribute_not_exists ではなく status を見る)
        self.client
            .put_item()
            .table_name(&self.table)
            .set_item(Some(item))
            .condition_expression("attribute_not_exists(PK) OR #st <> :approved")
            .expression_attribute_names("#st", "status")
            .expression_attribute_values(":approved", AttributeValue::S("approved".to_string()))
            .send()
            .await
            .map_err(|e| match e.as_service_error() {
                Some(se) if se.is_conditional_check_failed_exception() => RepoError::Conflict,
                _ => RepoError::Dynamo(e.to_string()),
            })?;
        Ok(())
    }

    async fn get_record(
        &self,
        floor: &str,
        created_at: &str,
        id: &str,
    ) -> Result<Option<CareRecord>, RepoError> {
        self.get_one(keys::floor_pk(floor), keys::record_sk(created_at, id))
            .await
    }

    async fn list_records_by_floor(&self, floor: &str) -> Result<Vec<CareRecord>, RepoError> {
        self.query_begins_with(keys::floor_pk(floor), keys::RECORD_SK_PREFIX)
            .await
    }

    async fn has_records_for_resident(&self, resident_id: &str) -> Result<bool, RepoError> {
        // GSI1 (PK=RESIDENT#{id}) を Limit 1 で引く。存在確認だけなので件数は数えない。
        let resp = self
            .client
            .query()
            .table_name(&self.table)
            .index_name(&self.index)
            .key_condition_expression("GSI1PK = :pk")
            .expression_attribute_values(
                ":pk",
                AttributeValue::S(keys::resident_gsi1_pk(resident_id)),
            )
            .limit(1)
            .send()
            .await
            .map_err(|e| RepoError::Dynamo(e.to_string()))?;
        Ok(resp.items.is_some_and(|items| !items.is_empty()))
    }

    async fn put_resident(&self, resident: &Resident) -> Result<(), RepoError> {
        self.put_with_keys(
            resident,
            vec![
                ("PK", keys::floor_pk(&resident.floor)),
                ("SK", keys::resident_sk(&resident.id)),
            ],
        )
        .await
    }

    async fn get_resident(&self, floor: &str, id: &str) -> Result<Option<Resident>, RepoError> {
        self.get_one(keys::floor_pk(floor), keys::resident_sk(id))
            .await
    }

    async fn list_residents(&self, floor: &str) -> Result<Vec<Resident>, RepoError> {
        self.query_begins_with(keys::floor_pk(floor), keys::RESIDENT_SK_PREFIX)
            .await
    }

    async fn delete_resident(&self, floor: &str, id: &str) -> Result<(), RepoError> {
        self.client
            .delete_item()
            .table_name(&self.table)
            .key("PK", AttributeValue::S(keys::floor_pk(floor)))
            .key("SK", AttributeValue::S(keys::resident_sk(id)))
            .send()
            .await
            .map_err(|e| RepoError::Dynamo(e.to_string()))?;
        Ok(())
    }

    async fn put_summary(&self, summary: &HandoverSummary) -> Result<(), RepoError> {
        self.put_with_keys(
            summary,
            vec![
                ("PK", keys::floor_pk(&summary.floor)),
                ("SK", keys::summary_sk(&summary.date, &summary.shift)),
            ],
        )
        .await
    }

    async fn get_summary(
        &self,
        floor: &str,
        date: &str,
        shift: &str,
    ) -> Result<Option<HandoverSummary>, RepoError> {
        self.get_one(keys::floor_pk(floor), keys::summary_sk(date, shift))
            .await
    }

    async fn list_summaries_by_floor(
        &self,
        floor: &str,
    ) -> Result<Vec<HandoverSummary>, RepoError> {
        self.query_begins_with(keys::floor_pk(floor), keys::SUMMARY_SK_PREFIX)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{CareRecord, Category, RecordStatus};

    // serde_dynamo による domain 型 ↔ AttributeValue マップの往復を検証する。
    // enum(Category/RecordStatus)・Option・schema_version が壊れないことが要点。
    #[test]
    fn care_record_round_trips_through_serde_dynamo() {
        let rec = CareRecord {
            schema_version: 1,
            id: "01HX".to_string(),
            floor: "3".to_string(),
            resident_id: "r1".to_string(),
            category: Category::Incident,
            body_ja: "転倒はないが見守りを継続".to_string(),
            original_text: "Không ngã nhưng cần theo dõi".to_string(),
            lang: "vi".to_string(),
            status: RecordStatus::Approved,
            created_by: "staff-1".to_string(),
            created_at: "2026-07-19T09:00:00Z".to_string(),
            approved_by: Some("staff-2".to_string()),
            approved_at: Some("2026-07-19T09:05:00Z".to_string()),
        };
        let item: HashMap<String, AttributeValue> = serde_dynamo::to_item(&rec).unwrap();
        let back: CareRecord = serde_dynamo::from_item(item).unwrap();
        assert_eq!(rec, back);
    }

    // 追加のキー属性 (PK/SK/GSI1) が混ざっても domain 型は無視して読み戻せる。
    #[test]
    fn extra_key_attributes_are_ignored_on_read() {
        let rec = CareRecord {
            schema_version: 1,
            id: "01HY".to_string(),
            floor: "1".to_string(),
            resident_id: "r2".to_string(),
            category: Category::Meal,
            body_ja: "全量摂取".to_string(),
            original_text: "全量摂取".to_string(),
            lang: "ja".to_string(),
            status: RecordStatus::Draft,
            created_by: "staff-1".to_string(),
            created_at: "2026-07-19T03:00:00Z".to_string(),
            approved_by: None,
            approved_at: None,
        };
        let mut item: HashMap<String, AttributeValue> = serde_dynamo::to_item(&rec).unwrap();
        item.insert("PK".to_string(), AttributeValue::S("FLOOR#1".to_string()));
        item.insert(
            "SK".to_string(),
            AttributeValue::S("RECORD#2026-07-19T03:00:00Z#01HY".to_string()),
        );
        item.insert(
            "GSI1PK".to_string(),
            AttributeValue::S("RESIDENT#r2".to_string()),
        );
        let back: CareRecord = serde_dynamo::from_item(item).unwrap();
        assert_eq!(rec, back);
    }
}
