//! 利用者マスタの CRUD。管理者ロールは設けず、認証済み職員は全員操作できる。

use domain::{Resident, ResidentStatus};

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

/// 削除要求の結果。呼び出し側 (画面) に「消えた」のか「退所になった」のかを伝える。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteOutcome {
    /// 記録が無かったため物理削除した (誤登録の取り消し)
    Deleted,
    /// 記録があるため退所扱いにした (記録は保存されたまま)
    Discharged,
}

/// 利用者を新規作成する。
pub async fn create(repo: &dyn Repository, input: ResidentInput) -> Result<Resident, ApiError> {
    validate(&input)?;
    ensure_room_available(repo, &input.floor, &input.room, None).await?;
    let resident = Resident {
        schema_version: domain::SCHEMA_VERSION,
        id: new_id(),
        floor: input.floor,
        name: input.name,
        room: input.room,
        baseline: input.baseline,
        created_at: now_rfc3339(),
        status: ResidentStatus::Active,
        discharged_at: None,
    };
    repo.put_resident(&resident).await?;
    Ok(resident)
}

/// 既存の利用者を更新する (created_at と在籍状態は保持)。
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
    ensure_room_available(repo, &input.floor, &input.room, Some(&existing.id)).await?;
    let resident = Resident {
        schema_version: domain::SCHEMA_VERSION,
        id: existing.id,
        floor: input.floor,
        name: input.name,
        room: input.room,
        baseline: input.baseline,
        created_at: existing.created_at,
        // 在籍状態は本 API では変えない (退所は delete 経由)
        status: existing.status,
        discharged_at: existing.discharged_at,
    };
    repo.put_resident(&resident).await?;
    Ok(resident)
}

/// フロアの利用者一覧を居室順に返す。
///
/// 既定では在籍中のみ。`include_discharged` で退所者も含める (過去記録の閲覧用)。
pub async fn list(
    repo: &dyn Repository,
    floor: &str,
    include_discharged: bool,
) -> Result<Vec<Resident>, ApiError> {
    let mut residents = repo.list_residents(floor).await?;
    if !include_discharged {
        residents.retain(|r| r.status == ResidentStatus::Active);
    }
    residents.sort_by(|a, b| a.room.cmp(&b.room));
    Ok(residents)
}

/// 利用者を削除する。
///
/// ケア記録には法定の保存義務があるため、記録が1件でもある利用者は物理削除せず
/// 退所 (`Discharged`) 扱いにする。記録が無い場合のみ物理削除する。
/// これにより「記録は残っているが参照先の利用者が存在しない」孤児データが発生しない。
pub async fn delete(
    repo: &dyn Repository,
    floor: &str,
    id: &str,
) -> Result<DeleteOutcome, ApiError> {
    let existing = repo
        .get_resident(floor, id)
        .await?
        .ok_or(ApiError::NotFound)?;

    if repo.has_records_for_resident(id).await? {
        let discharged = Resident {
            status: ResidentStatus::Discharged,
            discharged_at: Some(now_rfc3339()),
            ..existing
        };
        repo.put_resident(&discharged).await?;
        // 監査ログ: 退所処理は法定保存義務のある記録に関わるため記録する (氏名は含めない)。
        tracing::info!(resident_id = %id, floor = %floor, "resident discharged");
        Ok(DeleteOutcome::Discharged)
    } else {
        repo.delete_resident(floor, id).await?;
        tracing::info!(resident_id = %id, floor = %floor, "resident deleted (no records)");
        Ok(DeleteOutcome::Deleted)
    }
}

/// 同じフロアの在籍中の利用者に同じ部屋番号が無いか確認する。
///
/// `exclude_id` は更新時に自分自身を除外するために使う (部屋番号を変えずに保存できるように)。
/// 部屋番号未入力 (空文字) はチェック対象外 (複数人が「未割り当て」でも衝突ではない)。
/// 退所済みの利用者の部屋番号は空いているとみなす (新しい利用者が使ってよい)。
async fn ensure_room_available(
    repo: &dyn Repository,
    floor: &str,
    room: &str,
    exclude_id: Option<&str>,
) -> Result<(), ApiError> {
    let room = room.trim();
    if room.is_empty() {
        return Ok(());
    }
    let residents = repo.list_residents(floor).await?;
    let taken = residents.iter().any(|r| {
        r.status == ResidentStatus::Active
            && r.room.trim() == room
            && Some(r.id.as_str()) != exclude_id
    });
    if taken {
        return Err(ApiError::BadRequest(format!(
            "部屋番号「{room}」は既に使用されています"
        )));
    }
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
