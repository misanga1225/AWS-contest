//! ケア記録のビジネスロジック: LLM 構造化による下書き作成、承認、一覧。

use chrono::NaiveDate;
use domain::shift::{Shift, ShiftWindow};
use domain::{CareRecord, Category, RecordStatus};

use crate::config::AppConfig;
use crate::error::ApiError;
use crate::llm::{Llm, StructureRequest};
use crate::repository::{RepoError, Repository};
use crate::util::{new_id, now_rfc3339};

/// ケアメモ本文の最大文字数。Bedrock への入力肥大化・呼び出しコスト濫用を防ぐ上限。
const MAX_TEXT_CHARS: usize = 4000;

/// 下書き作成の入力。
pub struct CreateDraft {
    pub floor: String,
    /// 対象利用者。職員が画面で必ず選ぶ (LLM に推定させない)
    pub resident_id: String,
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
    if input.text.chars().count() > MAX_TEXT_CHARS {
        return Err(ApiError::BadRequest(format!(
            "本文が長すぎます(最大{MAX_TEXT_CHARS}文字)"
        )));
    }
    // 利用者は職員が必ず選ぶ。LLM 呼び出しの前に検証し、
    // 課金してから承認時に弾かれる (= 無駄なトークン消費) のを避ける。
    if input.resident_id.trim().is_empty() {
        return Err(ApiError::BadRequest("利用者が未選択です".to_string()));
    }
    if repo
        .get_resident(&input.floor, &input.resident_id)
        .await?
        .is_none()
    {
        return Err(ApiError::BadRequest(
            "指定の利用者が存在しません".to_string(),
        ));
    }

    let structured = llm
        .structure(StructureRequest {
            text: input.text.clone(),
        })
        .await?;

    // 逆翻訳の確認用テキストは、アプリが対応する外国人職員の言語 (en/vi) のときだけ保持する。
    // 逆翻訳 human-in-the-loop が意味を持つのは対応言語の職員が母語照合する場合に限られる。
    // LLM が日本語 (漢字が多いと稀に起こる) を zh 等と誤判定しても、無関係な言語の逆翻訳を
    // 承認画面に出さないためのガード。ja・非対応言語・空文字のときは None。
    let vt = structured.verification_text.trim();
    let verification_text = if !vt.is_empty() && matches!(structured.lang.as_str(), "en" | "vi") {
        Some(vt.to_string())
    } else {
        None
    };

    let record = CareRecord {
        schema_version: domain::SCHEMA_VERSION,
        id: new_id(),
        floor: input.floor,
        resident_id: input.resident_id,
        category: structured.category,
        body_ja: structured.body_ja,
        original_text: input.text,
        lang: structured.lang,
        verification_text,
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
    // verification_text (逆翻訳) は draft 段階で母語照合を助けるための確認用であり、
    // 承認時には更新も消去もしない (original_text/lang と同じく draft 時点の値を保持する)。
    // 承認画面 (DraftCard) でのみ表示し、承認済みレコードでは表示しないため、職員が
    // body_ja を編集して逆翻訳とズレても実害は無い。承認は職員が body_ja 自体を読んで確定する。
    record.status = RecordStatus::Approved;
    record.approved_by = Some(input.approved_by);
    record.approved_at = Some(now_rfc3339());

    // 条件付き書き込みで二重承認を原子的に防ぐ (get→put の間の競合対策)。
    match repo.put_record_if_unapproved(&record).await {
        Ok(()) => {
            // 監査ログ: 誰が・どのフロアの・どの記録を承認したか (氏名等のPIIは含めない)。
            tracing::info!(
                record_id = %record.id,
                floor = %record.floor,
                approved_by = %record.approved_by.as_deref().unwrap_or(""),
                "record approved"
            );
            Ok(record)
        }
        Err(RepoError::Conflict) => Err(ApiError::AlreadyApproved),
        Err(e) => Err(ApiError::Repo(e)),
    }
}

/// 下書き (draft) を削除する。承認済み記録は削除できない (訂正は新規記録として追加する)。
pub async fn delete_draft(
    repo: &dyn Repository,
    floor: &str,
    created_at: &str,
    id: &str,
) -> Result<(), ApiError> {
    let record = repo
        .get_record(floor, created_at, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if record.status == RecordStatus::Approved {
        return Err(ApiError::AlreadyApproved);
    }

    // 条件付き削除で、get→delete の間に承認された場合の競合を原子的に防ぐ。
    match repo.delete_record_if_draft(floor, created_at, id).await {
        Ok(()) => {
            // 監査ログ: 誰が・どのフロアの下書きを削除したか (氏名等のPIIは含めない)。
            tracing::info!(record_id = %id, floor = %floor, "draft record deleted");
            Ok(())
        }
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
