use std::sync::Arc;

use reqwest::Method;
use serde_json::json;

use crate::error::Result;
use crate::http::{HttpClient, RequestOptions};
use crate::models::*;

/// People, as grouped by face recognition.
///
/// The feature is off until a server administrator enables it, so every method here can
/// legitimately return nothing — check [`People::status`] before showing a person
/// interface.
pub struct People {
    http: Arc<HttpClient>,
}

impl People {
    pub(crate) fn new(http: Arc<HttpClient>) -> Self {
        Self { http }
    }

    pub async fn status(&self) -> Result<FaceStatus> {
        self.http
            .request(
                Method::GET,
                "/api/v1/people/status",
                RequestOptions::default(),
            )
            .await
    }

    /// Administrator only. Enabling downloads the models and scans the library.
    pub async fn set_enabled(&self, enabled: bool) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::POST,
                "/api/v1/people/enable",
                RequestOptions::json(&json!({ "enabled": enabled }))?,
            )
            .await?;
        Ok(())
    }

    pub async fn list(&self, include_hidden: bool) -> Result<Vec<Person>> {
        let page: Items<Person> = self
            .http
            .request(
                Method::GET,
                "/api/v1/people",
                RequestOptions::query(vec![("includeHidden".into(), include_hidden.to_string())]),
            )
            .await?;
        Ok(page.items)
    }

    pub async fn get(&self, person_id: &str) -> Result<PersonWithPhotos> {
        self.http
            .request(
                Method::GET,
                &format!("/api/v1/people/{person_id}"),
                RequestOptions::default(),
            )
            .await
    }

    pub async fn update(&self, person_id: &str, patch: &PersonUpdate) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::PATCH,
                &format!("/api/v1/people/{person_id}"),
                RequestOptions::json(patch)?,
            )
            .await?;
        Ok(())
    }

    /// Folds several clusters into one. Use when grouping split a person in two.
    pub async fn merge(&self, keep_id: &str, merge_ids: &[String]) -> Result<MovedCount> {
        self.http
            .request(
                Method::POST,
                "/api/v1/people/merge",
                RequestOptions::json(&json!({ "keepId": keep_id, "mergeIds": merge_ids }))?,
            )
            .await
    }

    /// Moves specific faces to another person, or detaches them with `None`.
    pub async fn reassign(&self, face_ids: &[String], person_id: Option<&str>) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::POST,
                "/api/v1/people/reassign",
                RequestOptions::json(&json!({ "faceIds": face_ids, "personId": person_id }))?,
            )
            .await?;
        Ok(())
    }

    pub async fn faces_in(&self, asset_id: &str) -> Result<Vec<DetectedFace>> {
        let page: Items<DetectedFace> = self
            .http
            .request(
                Method::GET,
                &format!("/api/v1/people/faces/{asset_id}"),
                RequestOptions::default(),
            )
            .await?;
        Ok(page.items)
    }

    /// A person's thumbnail, cropped from the photo their best face was found in.
    pub fn thumbnail_url(&self, face_id: &str) -> String {
        self.http
            .url_string(&format!("/api/v1/people/thumbnail/{face_id}"))
    }
}
