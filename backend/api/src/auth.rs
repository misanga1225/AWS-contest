//! 認証済みユーザーの抽出。
//!
//! 本番では API Gateway HTTP API の JWT オーソライザが検証済み claims を
//! リクエストコンテキストに載せる。ここからは `sub` (Cognito ユーザー ID) を取り出し、
//! 記録の作成者・承認者として証跡に焼き込む。
//!
//! HTTP 拡張はサーバ側専用でクライアントから設定できないため、テストは
//! `AuthUser` 拡張を直接注入して本番経路をバイパスする (認証の偽装経路にはならない)。

use axum::extract::FromRequestParts;
use axum::http::Extensions;
use axum::http::request::Parts;
use lambda_http::request::RequestContext;

use crate::error::ApiError;

/// 認証済みユーザーの Cognito サブジェクト。
#[derive(Clone, Debug)]
pub struct AuthUser(pub String);

impl AuthUser {
    pub fn id(&self) -> &str {
        &self.0
    }
}

/// JWT オーソライザが載せた claims から `sub` を取り出す。
fn jwt_sub(ext: &Extensions) -> Option<String> {
    match ext.get::<RequestContext>()? {
        RequestContext::ApiGatewayV2(ctx) => ctx
            .authorizer
            .as_ref()?
            .jwt
            .as_ref()?
            .claims
            .get("sub")
            .cloned(),
        _ => None,
    }
}

impl<S: Send + Sync> FromRequestParts<S> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // テストで注入された値を優先 (拡張はクライアント設定不可のため安全)
        if let Some(u) = parts.extensions.get::<AuthUser>() {
            return Ok(u.clone());
        }
        jwt_sub(&parts.extensions)
            .map(AuthUser)
            .ok_or(ApiError::Unauthorized)
    }
}
