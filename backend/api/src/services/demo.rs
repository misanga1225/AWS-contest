//! デモデータ初期化。架空の利用者と平常時情報 (baseline) を各フロアに投入する。
//!
//! id は `demo-{floor}-{n}` の固定値にして冪等 (再実行で重複せず上書き) にする。
//! 個人情報は架空。実データ投入には使わない。

use domain::{Resident, ResidentStatus};

use crate::error::ApiError;
use crate::repository::Repository;
use crate::util::now_rfc3339;

/// デモ用の利用者テンプレート (氏名は架空)。
const TEMPLATE: &[(&str, &str, &str)] = &[
    // (氏名, 居室, baseline)
    (
        "佐藤 花子",
        "01",
        "自立度は歩行器使用。食事は自力摂取。日中は談話室で過ごすことが多い。",
    ),
    (
        "鈴木 一郎",
        "02",
        "軽度認知症。血圧やや高め (収縮期 140 前後)。夜間はよく眠る。",
    ),
    (
        "高橋 みどり",
        "03",
        "嚥下やや低下。とろみ食対応。水分摂取を促す必要あり。",
    ),
    (
        "田中 健",
        "04",
        "車椅子。移乗は一部介助。皮膚が弱く発赤に注意。",
    ),
];

/// 指定フロア群にデモ利用者を投入し、投入した利用者を返す。
pub async fn seed(repo: &dyn Repository, floors: &[String]) -> Result<Vec<Resident>, ApiError> {
    if floors.is_empty() {
        return Err(ApiError::BadRequest(
            "フロアが指定されていません".to_string(),
        ));
    }
    let created_at = now_rfc3339();
    let mut created = Vec::new();
    for floor in floors {
        for (i, (name, room, baseline)) in TEMPLATE.iter().enumerate() {
            let resident = Resident {
                schema_version: domain::SCHEMA_VERSION,
                id: format!("demo-{floor}-{}", i + 1),
                floor: floor.clone(),
                name: (*name).to_string(),
                room: format!("{floor}{room}"),
                baseline: (*baseline).to_string(),
                created_at: created_at.clone(),
                status: ResidentStatus::Active,
                discharged_at: None,
            };
            repo.put_resident(&resident).await?;
            created.push(resident);
        }
    }
    // 監査ログ: デモデータ投入は本番データに混入しうる操作のため記録する。
    tracing::info!(floors = ?floors, count = created.len(), "demo data seeded");
    Ok(created)
}
