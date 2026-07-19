//! DynamoDB 単一テーブルのキー生成ヘルパー。
//!
//! キー設計 (db.md 準拠):
//!
//! | エンティティ | PK | SK |
//! |---|---|---|
//! | ケア記録 | `FLOOR#{floor}` | `RECORD#{created_at}#{id}` |
//! | 利用者 | `FLOOR#{floor}` | `RESIDENT#{id}` |
//! | サマリ | `FLOOR#{floor}` | `SUMMARY#{date}#{shift}` |
//!
//! GSI1 (利用者別時系列): PK=`RESIDENT#{id}` / SK=`RECORD#{created_at}#{id}`

/// パーティションキー (フロア単位)。
pub fn floor_pk(floor: &str) -> String {
    format!("FLOOR#{floor}")
}

/// ケア記録の SK。`created_at` は RFC3339 UTC のためソート順が時系列になる。
pub fn record_sk(created_at: &str, id: &str) -> String {
    format!("RECORD#{created_at}#{id}")
}

/// ケア記録を `begins_with` で引くための SK プレフィックス。
pub const RECORD_SK_PREFIX: &str = "RECORD#";

/// 利用者の SK。
pub fn resident_sk(id: &str) -> String {
    format!("RESIDENT#{id}")
}

/// 利用者を `begins_with` で引くための SK プレフィックス。
pub const RESIDENT_SK_PREFIX: &str = "RESIDENT#";

/// サマリの SK。
pub fn summary_sk(date: &str, shift: &str) -> String {
    format!("SUMMARY#{date}#{shift}")
}

/// サマリを `begins_with` で引くための SK プレフィックス。
pub const SUMMARY_SK_PREFIX: &str = "SUMMARY#";

/// 特定日のサマリを `begins_with` で引くためのプレフィックス (`SUMMARY#{date}#`)。
pub fn summary_sk_date_prefix(date: &str) -> String {
    format!("SUMMARY#{date}#")
}

/// GSI1 のパーティションキー (利用者別時系列)。
pub fn resident_gsi1_pk(resident_id: &str) -> String {
    format!("RESIDENT#{resident_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_sk_is_time_sortable() {
        let a = record_sk("2026-07-19T09:00:00Z", "01HB");
        let b = record_sk("2026-07-19T10:00:00Z", "01HA");
        assert!(a < b, "SK は created_at 昇順でソートされる");
        assert!(a.starts_with(RECORD_SK_PREFIX));
    }

    #[test]
    fn keys_use_expected_prefixes() {
        assert_eq!(floor_pk("3"), "FLOOR#3");
        assert_eq!(resident_sk("r1"), "RESIDENT#r1");
        assert_eq!(summary_sk("2026-07-19", "day"), "SUMMARY#2026-07-19#day");
        assert_eq!(summary_sk_date_prefix("2026-07-19"), "SUMMARY#2026-07-19#");
        assert_eq!(resident_gsi1_pk("r1"), "RESIDENT#r1");
    }
}
