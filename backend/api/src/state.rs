//! アプリ状態。axum の `State` には `Arc<AppState>` を使う。

use std::sync::Arc;

use crate::config::AppConfig;
use crate::llm::Llm;
use crate::repository::Repository;

/// ハンドラ全体で共有する依存。リポジトリと LLM はトレイトオブジェクトにして
/// テストでフェイクへ差し替えられるようにする。
pub struct AppState {
    pub repo: Arc<dyn Repository>,
    pub llm: Arc<dyn Llm>,
    pub config: AppConfig,
}

impl AppState {
    pub fn new(repo: Arc<dyn Repository>, llm: Arc<dyn Llm>, config: AppConfig) -> Arc<Self> {
        Arc::new(Self { repo, llm, config })
    }
}
