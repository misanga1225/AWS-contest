//! アプリ状態。axum の `State` には `Arc<AppState>` を使う。

use std::sync::Arc;

use crate::config::AppConfig;
use crate::llm::Llm;
use crate::media::{Storage, Transcriber};
use crate::repository::Repository;

/// ハンドラ全体で共有する依存。リポジトリ・LLM・ストレージ・文字起こしはすべて
/// トレイトオブジェクトにして、テストでフェイクへ差し替えられるようにする。
pub struct AppState {
    pub repo: Arc<dyn Repository>,
    pub llm: Arc<dyn Llm>,
    /// 音声アップロード (S3) 抽象。
    pub storage: Arc<dyn Storage>,
    /// 文字起こし (Transcribe) 抽象。
    pub transcriber: Arc<dyn Transcriber>,
    pub config: AppConfig,
}

impl AppState {
    pub fn new(
        repo: Arc<dyn Repository>,
        llm: Arc<dyn Llm>,
        storage: Arc<dyn Storage>,
        transcriber: Arc<dyn Transcriber>,
        config: AppConfig,
    ) -> Arc<Self> {
        Arc::new(Self {
            repo,
            llm,
            storage,
            transcriber,
            config,
        })
    }
}
