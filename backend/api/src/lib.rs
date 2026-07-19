//! 介護申し送り支援アプリの API バックエンド (ライブラリ)。
//!
//! バイナリ (`main.rs`) と summarizer クレートの双方から利用する。
//! ハンドラは薄く、ビジネスロジックは [`services`]、DB は [`repository`]、
//! LLM は [`llm`] のトレイトで抽象化してテスト可能にしている。

pub mod auth;
pub mod aws;
pub mod config;
pub mod error;
pub mod llm;
pub mod repository;
pub mod routes;
pub mod services;
pub mod state;
pub mod util;

pub use routes::router;
pub use state::AppState;
