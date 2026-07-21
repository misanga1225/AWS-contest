//! テスト用インメモリ [`Repository`]。DynamoDB Local を要さず結合テストを回すため、
//! キー設計 (PK/SK) を実 DynamoDB と同じ規則で模倣する。
//!
//! 結合テスト (別クレート) から使うため公開実装とし、lock 毒化は panic させず
//! [`RepoError`] に変換する。

use async_trait::async_trait;
use domain::{CareRecord, HandoverSummary, RecordStatus, Resident, keys};
use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use super::{RepoError, Repository};

type Store<V> = BTreeMap<(String, String), V>;
type Table<V> = Mutex<Store<V>>;

fn lock<V>(m: &Table<V>) -> Result<MutexGuard<'_, Store<V>>, RepoError> {
    m.lock()
        .map_err(|_: PoisonError<_>| RepoError::Dynamo("in-memory lock poisoned".to_string()))
}

/// (PK, SK) をキーにした BTreeMap で単一テーブルを模倣する。
#[derive(Default)]
pub struct InMemoryRepository {
    records: Table<CareRecord>,
    residents: Table<Resident>,
    summaries: Table<HandoverSummary>,
}

impl InMemoryRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl Repository for InMemoryRepository {
    async fn put_record(&self, rec: &CareRecord) -> Result<(), RepoError> {
        let pk = keys::floor_pk(&rec.floor);
        let sk = keys::record_sk(&rec.created_at, &rec.id);
        lock(&self.records)?.insert((pk, sk), rec.clone());
        Ok(())
    }

    async fn put_record_if_unapproved(&self, rec: &CareRecord) -> Result<(), RepoError> {
        let key = (
            keys::floor_pk(&rec.floor),
            keys::record_sk(&rec.created_at, &rec.id),
        );
        let mut guard = lock(&self.records)?;
        if let Some(existing) = guard.get(&key)
            && existing.status == RecordStatus::Approved
        {
            return Err(RepoError::Conflict);
        }
        guard.insert(key, rec.clone());
        Ok(())
    }

    async fn get_record(
        &self,
        floor: &str,
        created_at: &str,
        id: &str,
    ) -> Result<Option<CareRecord>, RepoError> {
        let key = (keys::floor_pk(floor), keys::record_sk(created_at, id));
        Ok(lock(&self.records)?.get(&key).cloned())
    }

    async fn list_records_by_floor(&self, floor: &str) -> Result<Vec<CareRecord>, RepoError> {
        let pk = keys::floor_pk(floor);
        Ok(lock(&self.records)?
            .iter()
            .filter(|((p, s), _)| *p == pk && s.starts_with(keys::RECORD_SK_PREFIX))
            .map(|(_, v)| v.clone())
            .collect())
    }

    async fn has_records_for_resident(&self, resident_id: &str) -> Result<bool, RepoError> {
        Ok(lock(&self.records)?
            .values()
            .any(|r| r.resident_id == resident_id))
    }

    async fn put_resident(&self, resident: &Resident) -> Result<(), RepoError> {
        let pk = keys::floor_pk(&resident.floor);
        let sk = keys::resident_sk(&resident.id);
        lock(&self.residents)?.insert((pk, sk), resident.clone());
        Ok(())
    }

    async fn get_resident(&self, floor: &str, id: &str) -> Result<Option<Resident>, RepoError> {
        let key = (keys::floor_pk(floor), keys::resident_sk(id));
        Ok(lock(&self.residents)?.get(&key).cloned())
    }

    async fn list_residents(&self, floor: &str) -> Result<Vec<Resident>, RepoError> {
        let pk = keys::floor_pk(floor);
        Ok(lock(&self.residents)?
            .iter()
            .filter(|((p, s), _)| *p == pk && s.starts_with(keys::RESIDENT_SK_PREFIX))
            .map(|(_, v)| v.clone())
            .collect())
    }

    async fn delete_resident(&self, floor: &str, id: &str) -> Result<(), RepoError> {
        let key = (keys::floor_pk(floor), keys::resident_sk(id));
        lock(&self.residents)?.remove(&key);
        Ok(())
    }

    async fn put_summary(&self, summary: &HandoverSummary) -> Result<(), RepoError> {
        let pk = keys::floor_pk(&summary.floor);
        let sk = keys::summary_sk(&summary.date, &summary.shift);
        lock(&self.summaries)?.insert((pk, sk), summary.clone());
        Ok(())
    }

    async fn get_summary(
        &self,
        floor: &str,
        date: &str,
        shift: &str,
    ) -> Result<Option<HandoverSummary>, RepoError> {
        let key = (keys::floor_pk(floor), keys::summary_sk(date, shift));
        Ok(lock(&self.summaries)?.get(&key).cloned())
    }

    async fn list_summaries_by_floor(
        &self,
        floor: &str,
    ) -> Result<Vec<HandoverSummary>, RepoError> {
        let pk = keys::floor_pk(floor);
        Ok(lock(&self.summaries)?
            .iter()
            .filter(|((p, s), _)| *p == pk && s.starts_with(keys::SUMMARY_SK_PREFIX))
            .map(|(_, v)| v.clone())
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::Category;

    fn record(status: RecordStatus) -> CareRecord {
        CareRecord {
            schema_version: 1,
            id: "01A".to_string(),
            floor: "3".to_string(),
            resident_id: "r1".to_string(),
            category: Category::Note,
            body_ja: "x".to_string(),
            original_text: "x".to_string(),
            lang: "ja".to_string(),
            verification_text: None,
            status,
            created_by: "u1".to_string(),
            created_at: "2026-07-19T03:00:00Z".to_string(),
            approved_by: None,
            approved_at: None,
        }
    }

    #[tokio::test]
    async fn conditional_put_rejects_overwriting_approved() {
        let repo = InMemoryRepository::new();
        // 承認済みを保存
        let mut approved = record(RecordStatus::Approved);
        approved.approved_by = Some("u2".to_string());
        repo.put_record(&approved).await.unwrap();

        // 同一キーへの条件付き書き込みは Conflict
        let overwrite = record(RecordStatus::Approved);
        let err = repo.put_record_if_unapproved(&overwrite).await.unwrap_err();
        assert!(matches!(err, RepoError::Conflict));
    }

    #[tokio::test]
    async fn conditional_put_allows_draft_to_approved() {
        let repo = InMemoryRepository::new();
        repo.put_record(&record(RecordStatus::Draft)).await.unwrap();
        // draft → approved は許可
        let approved = record(RecordStatus::Approved);
        assert!(repo.put_record_if_unapproved(&approved).await.is_ok());
    }
}
