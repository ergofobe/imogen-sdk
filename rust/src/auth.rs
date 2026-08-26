use std::sync::Arc;

use reqwest::Method;

use crate::error::Result;
use crate::http::{HttpClient, RequestOptions};
use crate::models::*;

pub struct Auth {
    http: Arc<HttpClient>,
}

impl Auth {
    pub(crate) fn new(http: Arc<HttpClient>) -> Self {
        Self { http }
    }

    /// What the sign-in screen needs before anyone has authenticated.
    pub async fn config(&self) -> Result<AuthConfig> {
        self.http
            .request(
                Method::GET,
                "/api/v1/auth/config",
                RequestOptions::default(),
            )
            .await
    }

    pub async fn login(&self, request: &LoginRequest) -> Result<User> {
        self.http
            .request(
                Method::POST,
                "/api/v1/auth/login",
                RequestOptions::json(request)?,
            )
            .await
    }

    pub async fn signup(&self, request: &SignupRequest) -> Result<User> {
        self.http
            .request(
                Method::POST,
                "/api/v1/auth/signup",
                RequestOptions::json(request)?,
            )
            .await
    }

    pub async fn logout(&self) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::POST,
                "/api/v1/auth/logout",
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    pub async fn logout_everywhere(&self) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::POST,
                "/api/v1/auth/logout-everywhere",
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    pub async fn me(&self) -> Result<User> {
        self.http
            .request(Method::GET, "/api/v1/auth/me", RequestOptions::default())
            .await
    }

    /// Edits your own name or email. Not available to provider-managed accounts.
    pub async fn update_profile(&self, patch: &ProfileUpdate) -> Result<User> {
        self.http
            .request(
                Method::PATCH,
                "/api/v1/auth/me",
                RequestOptions::json(patch)?,
            )
            .await
    }

    pub async fn change_password(&self, request: &PasswordChangeRequest) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::POST,
                "/api/v1/auth/password",
                RequestOptions::json(request)?,
            )
            .await?;
        Ok(())
    }

    /// Where to send a browser to begin single sign-on.
    pub fn oidc_start_url(&self, return_to: &str) -> Result<String> {
        Ok(self
            .http
            .url(
                "/api/v1/auth/oidc/start",
                &[("returnTo".into(), return_to.into())],
            )?
            .to_string())
    }
}
