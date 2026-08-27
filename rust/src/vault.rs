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

    /// A sample of the vault, newest first, and how big the vault actually is.
    ///
    /// The ordinary [`AssetPage`] rather than a bare `Vec`, because the server answers
    /// `pageOf(Asset)` here as it does everywhere else. This endpoint is capped, and the
    /// cap used to be invisible: two hundred photographs with no cursor and no count reads
    /// as "that is all of them", which for a larger vault was simply untrue. `next_cursor`
    /// is always `None` — this endpoint does not page — and `total` is what makes the cap
    /// visible instead of silent. A caller that wants the whole vault wants
    /// [`Vault::timeline`] and [`Vault::timeline_bucket`].
    pub async fn list(&self, limit: u32) -> Result<AssetPage> {
        self.http
            .request(
                Method::GET,
                "/api/v1/vault/assets",
                RequestOptions::query(vec![("limit".into(), limit.to_string())]),
            )
            .await
    }

    /// One row per day in the vault, for sizing the grid before any tile arrives.
    ///
    /// The vault has a spine of its own because it cannot have a filter: [`AssetFilter`]
    /// deliberately cannot express "inside the vault", so the scoping is done server-side
    /// behind the unlock rather than by anything the caller sends. `covers` is the only
    /// parameter the route reads, so it is the only one this takes.
    pub async fn timeline(&self, covers: Option<bool>) -> Result<Timeline> {
        let mut query = Vec::new();
        if let Some(covers) = covers {
            query.push(("covers".to_string(), covers.to_string()));
        }
        self.http
            .request(
                Method::GET,
                "/api/v1/vault/timeline",
                RequestOptions::query(query),
            )
            .await
    }

    /// Every tile in one period of the vault, in one round trip.
    ///
    /// `period`, `cursor` and `limit` and nothing else: a filter this accepted would be a
    /// filter that could widen what the vault hands back. `limit` left as `None` takes the
    /// server's default rather than a number this client shipped with.
    pub async fn timeline_bucket(
        &self,
        period: &str,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<TilePage> {
        let mut query = vec![("period".to_string(), period.to_string())];
        if let Some(cursor) = cursor {
            query.push(("cursor".to_string(), cursor.to_string()));
        }
        if let Some(limit) = limit {
            query.push(("limit".to_string(), limit.to_string()));
        }
        self.http
            .request(
                Method::GET,
                "/api/v1/vault/timeline/bucket",
                RequestOptions::query(query),
            )
            .await
    }

    pub async fn move_in(&self, selection: &AssetSelection) -> Result<MovedCount> {
        selection.validate()?;
        self.http
            .request(
                Method::POST,
                "/api/v1/vault/assets",
                RequestOptions::json(selection)?,
            )
            .await
    }

    pub async fn move_out(&self, selection: &AssetSelection) -> Result<MovedCount> {
        selection.validate()?;
        self.http
            .request(
                Method::DELETE,
                "/api/v1/vault/assets",
                RequestOptions::json(selection)?,
            )
            .await
    }
}
