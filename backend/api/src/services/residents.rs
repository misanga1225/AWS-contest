//! 利用者マスタの CRUD。管理者ロールは設けず、認証済み職員は全員操作できる。

use domain::Resident;

use crate::error::ApiError;
use crate::repository::Repository;
use crate::util::{new_id, now_rfc3339};

/// 新規作成・更新の入力。
pub struct ResidentInput {
    pub floor: String,
    pub name: String,
    pub room: String,
    pub baseline: String,
}

/// 利用者を新規作成する。
pub async fn create(repo: &dyn Repository, input: ResidentInput) -> Result<Resident, ApiError> {
    validate(&input)?;
    let resident = Resident {
        schema_version: domain::SCHEMA_VERSION,
        id: new_id(),
        floor: input.floor,
        name: input.name,
        room: input.room,
        baseline: input.baseline,
        created_at: now_rfc3339(),
    };
    repo.put_resident(&resident).await?;
    Ok(resident)
}

/// 既存の利用者を更新する (created_at は保持)。
pub async fn update(
    repo: &dyn Repository,
    floor: &str,
    id: &str,
    input: ResidentInput,
) -> Result<Resident, ApiError> {
    validate(&input)?;
    let existing = repo
        .get_resident(floor, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let resident = Resident {
        schema_version: domain::SCHEMA_VERSION,
        id: existing.id,
        floor: input.floor,
        name: input.name,
        room: input.room,
        baseline: input.baseline,
        created_at: existing.created_at,
    };
    repo.put_resident(&resident).await?;
    Ok(resident)
}

/// フロアの利用者一覧を居室順に返す。
pub async fn list(repo: &dyn Repository, floor: &str) -> Result<Vec<Resident>, ApiError> {
    let mut residents = repo.list_residents(floor).await?;
    residents.sort_by(|a, b| a.room.cmp(&b.room));
    Ok(residents)
}

/// 利用者を削除する。
pub async fn delete(repo: &dyn Repository, floor: &str, id: &str) -> Result<(), ApiError> {
    repo.delete_resident(floor, id).await?;
    Ok(())
}

fn validate(input: &ResidentInput) -> Result<(), ApiError> {
    if input.floor.trim().is_empty() {
        return Err(ApiError::BadRequest("フロアが空です".to_string()));
    }
    if input.name.trim().is_empty() {
        return Err(ApiError::BadRequest("氏名が空です".to_string()));
    }
    Ok(())
}
