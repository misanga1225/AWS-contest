//! ケア記録のビジネスロジック: LLM 構造化による下書き作成、承認、一覧。

use chrono::NaiveDate;
use domain::shift::{Shift, ShiftWindow};
use domain::{CareRecord, Category, RecordStatus};

use crate::config::AppConfig;
use crate::error::ApiError;
use crate::llm::{Llm, ResidentBrief, StructureRequest};
use crate::repository::{RepoError, Repository};
use crate::util::{new_id, now_rfc3339};

/// 下書き作成の入力。
pub struct CreateDraft {
    pub floor: String,
    /// 職員が先に選んだ利用者 (任意)。無ければ LLM の推定を使う
    pub resident_id: Option<String>,
    pub text: String,
    /// 認証済み作成者 (Cognito sub)
    pub created_by: String,
}

/// 承認の入力 (職員が下書きを確認・修正した最終値)。
pub struct ApproveInput {
    pub id: String,
    pub floor: String,
    pub created_at: String,
    pub resident_id: String,
    pub category: Category,
    pub body_ja: String,
    /// 認証済み承認者 (Cognito sub)
    pub approved_by: String,
}

/// 一覧のフィルタ。
pub struct ListFilter {
    pub floor: String,
    pub shift: Option<Shift>,
    pub date: Option<NaiveDate>,
    pub status: Option<RecordStatus>,
}

/// 母語入力を LLM で構造化し、下書き (draft) 記録として保存する。
///
/// LLM 出力はそのまま確定させず必ず draft にする。原文と言語コードを保存する。
pub async fn create_draft(
    repo: &dyn Repository,
    llm: &dyn Llm,
    input: CreateDraft,
) -> Result<CareRecord, ApiError> {
    if input.text.trim().is_empty() {
        return Err(ApiError::BadRequest("本文が空です".to_string()));
    }
    let residents = repo.list_residents(&input.floor).await?;
    let briefs: Vec<ResidentBrief> = residents
        .iter()
        .map(|r| ResidentBrief {
            id: r.id.clone(),
            name: r.name.clone(),
            room: r.room.clone(),
        })
        .collect();

    let structured = llm
        .structure(StructureRequest {
            text: input.text.clone(),
            residents: briefs,
        })
        .await?;

    // 職員の明示選択を優先し、無ければ LLM 推定、それも無ければ空 (承認時に補う)
    let resident_id = input
        .resident_id
        .filter(|s| !s.is_empty())
        .or(structured.resident_id)
        .unwrap_or_default();

    let record = CareRecord {
        schema_version: domain::SCHEMA_VERSION,
        id: new_id(),
        floor: input.floor,
        resident_id,
        category: structured.category,
        body_ja: structured.body_ja,
        original_text: input.text,
        lang: structured.lang,
        status: RecordStatus::Draft,
        created_by: input.created_by,
        created_at: now_rfc3339(),
        approved_by: None,
        approved_at: None,
    };
    repo.put_record(&record).await?;
    Ok(record)
}

/// 下書きを承認済みに確定する。承認済み記録の再承認・上書きは拒否する。
pub async fn approve(repo: &dyn Repository, input: ApproveInput) -> Result<CareRecord, ApiError> {
    let mut record = repo
        .get_record(&input.floor, &input.created_at, &input.id)
        .await?
        .ok_or(ApiError::NotFound)?;

    if record.status == RecordStatus::Approved {
        return Err(ApiError::AlreadyApproved);
    }
    if input.resident_id.is_empty() {
        return Err(ApiError::BadRequest("利用者が未選択です".to_string()));
    }
    // 利用者の実在確認 (証跡の整合性)
    if repo
        .get_resident(&input.floor, &input.resident_id)
        .await?
        .is_none()
    {
        return Err(ApiError::BadRequest(
            "指定の利用者が存在しません".to_string(),
        ));
    }

    record.resident_id = input.resident_id;
    record.category = input.category;
    record.body_ja = input.body_ja;
    record.status = RecordStatus::Approved;
    record.approved_by = Some(input.approved_by);
    record.approved_at = Some(now_rfc3339());

    // 条件付き書き込みで二重承認を原子的に防ぐ (get→put の間の競合対策)。
    match repo.put_record_if_unapproved(&record).await {
        Ok(()) => Ok(record),
        Err(RepoError::Conflict) => Err(ApiError::AlreadyApproved),
        Err(e) => Err(ApiError::Repo(e)),
    }
}

/// フロアの記録を条件で絞って時系列 (新しい順) に返す。
pub async fn list(
    repo: &dyn Repository,
    config: &AppConfig,
    filter: ListFilter,
) -> Result<Vec<CareRecord>, ApiError> {
    let mut records = repo.list_records_by_floor(&filter.floor).await?;

    if let Some(status) = filter.status {
        records.retain(|r| r.status == status);
    }
    if let (Some(shift), Some(date)) = (filter.shift, filter.date) {
        let window = ShiftWindow::for_date(&config.shift, date, shift);
        records.retain(|r| window.contains_rfc3339(&r.created_at));
    }
    // created_at 降順 (新しい順)
    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(records)
}
