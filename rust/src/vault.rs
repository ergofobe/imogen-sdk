use std::sync::Arc;

use reqwest::Method;
use serde_json::json;

use crate::error::Result;
use crate::http::{HttpClient, RequestOptions};
use crate::models::*;

/// The vault holds photographs kept out of the ordinary library entirely — absent from
/// the timeline, search, albums, shared links, and anything an AI assistant can reach.
///
/// It opens only for a signed-in browser session that re-enters the vault passphrase. A
/// bearer token cannot open it, so these methods are unavailable to API clients by design
/// rather than by omission.
pub struct Vault {
    http: Arc<HttpClient>,
}

impl Vault {
    pub(crate) fn new(http: Arc<HttpClient>) -> Self {
        Self { http }
    }

    pub async fn status(&self) -> Result<VaultStatus> {
        self.http
            .request(
                Method::GET,
                "/api/v1/vault/status",
                RequestOptions::default(),
            )
            .await
    }

    /// Sets the passphrase. Changing an existing one requires the vault to be open.
    pub async fn set_passphrase(&self, passphrase: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::POST,
                "/api/v1/vault/setup",
                RequestOptions::json(&json!({ "passphrase": passphrase }))?,
            )
            .await?;
        Ok(())
    }

    pub async fn unlock(&self, passphrase: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::POST,
                "/api/v1/vault/unlock",
                RequestOptions::json(&json!({ "passphrase": passphrase }))?,
            )
            .await?;
        Ok(())
    }

    pub async fn lock(&self) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::POST,
                "/api/v1/vault/lock",
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    pub async fn list(&self, limit: u32) -> Result<Vec<Asset>> {
        let page: Items<Asset> = self
            .http
            .request(
                Method::GET,
                "/api/v1/vault/assets",
                RequestOptions::query(vec![("limit".into(), limit.to_string())]),
            )
            .await?;
        Ok(page.items)
    }

    pub async fn move_in(&self, selection: &AssetSelection) -> Result<MovedCount> {
        self.http
            .request(
                Method::POST,
                "/api/v1/vault/assets",
                RequestOptions::json(selection)?,
            )
            .await
    }

    pub async fn move_out(&self, selection: &AssetSelection) -> Result<MovedCount> {
        self.http
            .request(
                Method::DELETE,
                "/api/v1/vault/assets",
                RequestOptions::json(selection)?,
            )
            .await
    }
}
