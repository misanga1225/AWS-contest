//! DynamoDB アクセスの抽象。
//!
//! domain 型と serde_dynamo で相互変換する実装 ([`dynamo::DynamoRepository`]) と、
//! テスト用のインメモリ実装 ([`memory::InMemoryRepository`]) を差し替え可能にする。
//! 取得は Query + `begins_with` を使い、Scan はデモデータ初期化のみで許可する。

use async_trait::async_trait;
use domain::{CareRecord, HandoverSummary, Resident};

pub mod dynamo;
pub mod memory;

/// データストアエラー。
#[derive(Debug, thiserror::Error)]
pub enum RepoError {
    #[error("DynamoDB 操作に失敗しました: {0}")]
    Dynamo(String),
    #[error("アイテムの変換に失敗しました: {0}")]
    Serde(String),
    /// 条件付き書き込みの前提が崩れた (例: 承認済み記録への上書き)。
    #[error("条件付き書き込みが競合しました")]
    Conflict,
}

/// 単一テーブルへのアクセスパターン。
#[async_trait]
pub trait Repository: Send + Sync {
    // --- ケア記録 ---
    /// 記録を保存する (draft の作成・上書きに使う)。
    async fn put_record(&self, rec: &CareRecord) -> Result<(), RepoError>;

    /// 承認済みでない場合のみ記録を保存する (承認確定用)。
    ///
    /// 既存アイテムが既に `approved` なら [`RepoError::Conflict`] を返し、二重承認や
    /// 承認済み記録の上書きを原子的に防ぐ (証跡の改ざん耐性)。
    async fn put_record_if_unapproved(&self, rec: &CareRecord) -> Result<(), RepoError>;

    /// PK+SK 完全一致で 1 件取得する。
    async fn get_record(
        &self,
        floor: &str,
        created_at: &str,
        id: &str,
    ) -> Result<Option<CareRecord>, RepoError>;

    /// フロアの全記録を時系列で取得する (`begins_with(SK, "RECORD#")`)。
    async fn list_records_by_floor(&self, floor: &str) -> Result<Vec<CareRecord>, RepoError>;

    // --- 利用者 ---
    async fn put_resident(&self, resident: &Resident) -> Result<(), RepoError>;
    async fn get_resident(&self, floor: &str, id: &str) -> Result<Option<Resident>, RepoError>;
    async fn list_residents(&self, floor: &str) -> Result<Vec<Resident>, RepoError>;
    async fn delete_resident(&self, floor: &str, id: &str) -> Result<(), RepoError>;

    // --- サマリ ---
    async fn put_summary(&self, summary: &HandoverSummary) -> Result<(), RepoError>;
    async fn get_summary(
        &self,
        floor: &str,
        date: &str,
        shift: &str,
    ) -> Result<Option<HandoverSummary>, RepoError>;
    async fn list_summaries_by_floor(&self, floor: &str)
    -> Result<Vec<HandoverSummary>, RepoError>;
}
