use std::sync::Arc;

use reqwest::Method;
use serde_json::json;

use crate::error::Result;
use crate::http::{HttpClient, RequestOptions};
use crate::models::*;

pub struct Albums {
    http: Arc<HttpClient>,
}

impl Albums {
    pub(crate) fn new(http: Arc<HttpClient>) -> Self {
        Self { http }
    }

    pub async fn list(&self) -> Result<Vec<Album>> {
        let page: Items<Album> = self
            .http
            .request(Method::GET, "/api/v1/albums", RequestOptions::default())
            .await?;
        Ok(page.items)
    }

    pub async fn get(&self, album_id: &str) -> Result<AlbumWithAssets> {
        self.http
            .request(
                Method::GET,
                &format!("/api/v1/albums/{album_id}"),
                RequestOptions::default(),
            )
            .await
    }

    pub async fn create(&self, input: &AlbumCreate) -> Result<Album> {
        self.http
            .request(Method::POST, "/api/v1/albums", RequestOptions::json(input)?)
            .await
    }

    pub async fn update(&self, album_id: &str, patch: &AlbumUpdate) -> Result<Album> {
        self.http
            .request(
                Method::PATCH,
                &format!("/api/v1/albums/{album_id}"),
                RequestOptions::json(patch)?,
            )
            .await
    }

    pub async fn remove(&self, album_id: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::DELETE,
                &format!("/api/v1/albums/{album_id}"),
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    pub async fn add_assets(
        &self,
        album_id: &str,
        asset_ids: &[String],
    ) -> Result<AlbumAssetsResult> {
        self.http
            .request(
                Method::POST,
                &format!("/api/v1/albums/{album_id}/assets"),
                RequestOptions::json(&json!({ "assetIds": asset_ids }))?,
            )
            .await
    }

    pub async fn remove_assets(
        &self,
        album_id: &str,
        asset_ids: &[String],
    ) -> Result<RemovedCount> {
        self.http
            .request(
                Method::DELETE,
                &format!("/api/v1/albums/{album_id}/assets"),
                RequestOptions::json(&json!({ "assetIds": asset_ids }))?,
            )
            .await
    }

    /// The live public link for this album, or `None`.
    pub async fn share_link(&self, album_id: &str) -> Result<Option<ShareLink>> {
        self.http
            .request(
                Method::GET,
                &format!("/api/v1/albums/{album_id}/share"),
                RequestOptions::default(),
            )
            .await
    }

    pub async fn share(&self, album_id: &str, input: &ShareLinkCreate) -> Result<ShareLink> {
        self.http
            .request(
                Method::POST,
                &format!("/api/v1/albums/{album_id}/share"),
                RequestOptions::json(input)?,
            )
            .await
    }

    pub async fn unshare(&self, album_id: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::DELETE,
                &format!("/api/v1/albums/{album_id}/share"),
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }
}
