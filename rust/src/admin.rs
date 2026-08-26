use std::sync::Arc;

use reqwest::Method;
use serde_json::json;

use crate::error::Result;
use crate::http::{HttpClient, RequestOptions};
use crate::models::*;

/// Server administration.
///
/// Every endpoint here answers 404 rather than 403 to anyone who is not an administrator,
/// so a refusal is indistinguishable from a route that does not exist. Treat a not-found
/// from these methods as "you may not", not as a bug.
pub struct Admin {
    http: Arc<HttpClient>,
}

impl Admin {
    pub(crate) fn new(http: Arc<HttpClient>) -> Self {
        Self { http }
    }

    /// Every account on the server, oldest first. Deleted accounts are not included.
    pub async fn users(&self) -> Result<Vec<AdminUser>> {
        let page: Items<AdminUser> = self
            .http
            .request(
                Method::GET,
                "/api/v1/admin/users",
                RequestOptions::default(),
            )
            .await?;
        Ok(page.items)
    }

    /// Changes a role, or suspends and restores access.
    pub async fn update_user(&self, user_id: &str, patch: &AdminUserUpdate) -> Result<AdminUser> {
        self.http
            .request(
                Method::PATCH,
                &format!("/api/v1/admin/users/{user_id}"),
                RequestOptions::json(patch)?,
            )
            .await
    }

    /// Removes the account. Its photographs go to the trash, not the incinerator.
    pub async fn delete_user(&self, user_id: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::DELETE,
                &format!("/api/v1/admin/users/{user_id}"),
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    /// Sets someone's password and ends every session they had.
    pub async fn reset_password(&self, user_id: &str, password: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::POST,
                &format!("/api/v1/admin/users/{user_id}/password"),
                RequestOptions::json(&json!({ "password": password }))?,
            )
            .await?;
        Ok(())
    }

    pub async fn invites(&self) -> Result<Vec<Invite>> {
        let page: Items<Invite> = self
            .http
            .request(
                Method::GET,
                "/api/v1/admin/invites",
                RequestOptions::default(),
            )
            .await?;
        Ok(page.items)
    }

    /// The returned token is the only legible copy. It is stored hashed.
    pub async fn create_invite(&self, input: &InviteCreate) -> Result<InviteCreated> {
        self.http
            .request(
                Method::POST,
                "/api/v1/admin/invites",
                RequestOptions::json(input)?,
            )
            .await
    }

    pub async fn revoke_invite(&self, invite_id: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::DELETE,
                &format!("/api/v1/admin/invites/{invite_id}"),
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    /// Queue depth, what is running, and what the pipeline gave up on.
    pub async fn queue(&self) -> Result<QueueHealth> {
        self.http
            .request(
                Method::GET,
                "/api/v1/admin/queue",
                RequestOptions::default(),
            )
            .await
    }

    /// Puts one failed job back in the queue with its attempts cleared.
    pub async fn retry_job(&self, job_id: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::POST,
                &format!("/api/v1/admin/queue/{job_id}/retry"),
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    pub async fn retry_all_jobs(&self) -> Result<u64> {
        let result: AffectedCount = self
            .http
            .request(
                Method::POST,
                "/api/v1/admin/queue/retry",
                RequestOptions::default(),
            )
            .await?;
        Ok(result.count)
    }

    pub async fn discard_job(&self, job_id: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::DELETE,
                &format!("/api/v1/admin/queue/{job_id}"),
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    /// Applications allowed to act on someone's behalf.
    pub async fn clients(&self) -> Result<Vec<AdminClient>> {
        let page: Items<AdminClient> = self
            .http
            .request(
                Method::GET,
                "/api/v1/admin/clients",
                RequestOptions::default(),
            )
            .await?;
        Ok(page.items)
    }

    /// Removes an application. Its tokens go with it.
    pub async fn revoke_client(&self, client_id: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::DELETE,
                &format!("/api/v1/admin/clients/{client_id}"),
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    pub async fn sessions(&self) -> Result<Vec<AdminSession>> {
        let page: Items<AdminSession> = self
            .http
            .request(
                Method::GET,
                "/api/v1/admin/sessions",
                RequestOptions::default(),
            )
            .await?;
        Ok(page.items)
    }

    /// Ends a session. Refuses the one making the request.
    pub async fn revoke_session(&self, session_id: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::DELETE,
                &format!("/api/v1/admin/sessions/{session_id}"),
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    /// Where the bytes are, per variant and per account.
    pub async fn storage(&self) -> Result<StorageReport> {
        self.http
            .request(
                Method::GET,
                "/api/v1/admin/storage",
                RequestOptions::default(),
            )
            .await
    }

    pub async fn settings(&self) -> Result<ServerSettings> {
        self.http
            .request(
                Method::GET,
                "/api/v1/admin/settings",
                RequestOptions::default(),
            )
            .await
    }

    /// Takes effect at once. The stored value wins over the environment.
    pub async fn update_settings(&self, patch: &ServerSettingsUpdate) -> Result<ServerSettings> {
        self.http
            .request(
                Method::PATCH,
                "/api/v1/admin/settings",
                RequestOptions::json(patch)?,
            )
            .await
    }

    /// Every link that is public right now, across all accounts.
    pub async fn shares(&self) -> Result<Vec<AdminShareLink>> {
        let page: Items<AdminShareLink> = self
            .http
            .request(
                Method::GET,
                "/api/v1/admin/shares",
                RequestOptions::default(),
            )
            .await?;
        Ok(page.items)
    }

    /// Closes a link, whoever made it.
    pub async fn revoke_share(&self, share_id: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::DELETE,
                &format!("/api/v1/admin/shares/{share_id}"),
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }
}
