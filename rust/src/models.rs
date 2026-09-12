//! The API contract, as Rust types.
//!
//! Timestamps stay `String` rather than becoming a date type. The contract specifies
//! ISO-8601 and nothing else, and a client that reformats on the way through is a client
//! that eventually sends back something the server did not give it.

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

// --- assets ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetType {
    Image,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetVariant {
    Original,
    Preview,
    Thumbnail,
}

impl AssetVariant {
    pub fn as_str(self) -> &'static str {
        match self {
            AssetVariant::Original => "original",
            AssetVariant::Preview => "preview",
            AssetVariant::Thumbnail => "thumbnail",
        }
    }
}

/// Processing lifecycle. Clients show a placeholder until an asset reaches `Ready`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetStatus {
    Pending,
    Processing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExifData {
    pub make: Option<String>,
    pub model: Option<String>,
    pub lens: Option<String>,
    pub f_number: Option<f64>,
    pub exposure_time: Option<f64>,
    pub iso: Option<i64>,
    pub focal_length: Option<f64>,
    pub orientation: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoPoint {
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default)]
    pub altitude: Option<f64>,
    /// Reverse-geocoded place name, when available.
    #[serde(default)]
    pub place: Option<String>,
}

/// How a location is read off a response. A point on a map needs both coordinates, and
/// each has to fall inside its own range, so an object missing either -- or carrying a
/// latitude of 200 -- deserialises as no location at all, place name included, since a
/// name with nothing to pin it to is not something a client can show. The shape has to be
/// absorbed rather than rejected: a server that read a GPS block and made nothing usable
/// of it still answers with the object, and clients outlive the servers they talk to.
/// This is the response path only. On the way out, `GeoPoint` is range-checked in the
/// TypeScript port and nowhere else, so a client here can still send a latitude of 200 and
/// have it come back as no location at all. See ergofobe/imogen-sdk#40.
fn deserialize_location<'de, D>(deserializer: D) -> Result<Option<GeoPoint>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Wire {
        #[serde(default)]
        latitude: Option<f64>,
        #[serde(default)]
        longitude: Option<f64>,
        #[serde(default)]
        altitude: Option<f64>,
        #[serde(default)]
        place: Option<String>,
    }

    let wire = Option::<Wire>::deserialize(deserializer)?;
    Ok(wire.and_then(|wire| match (wire.latitude, wire.longitude) {
        (Some(latitude), Some(longitude))
            if (-90.0..=90.0).contains(&latitude) && (-180.0..=180.0).contains(&longitude) =>
        {
            Some(GeoPoint {
                latitude,
                longitude,
                altitude: wire.altitude,
                place: wire.place,
            })
        }
        _ => None,
    }))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub owner_id: String,
    pub r#type: AssetType,
    pub status: AssetStatus,
    pub original_filename: String,
    pub mime_type: String,
    /// SHA-256 of the original bytes. Stable identity across re-uploads.
    pub checksum: String,
    pub size_bytes: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Seconds. `None` for images.
    pub duration: Option<f64>,
    pub captured_at: String,
    /// True when `captured_at` came from EXIF rather than a fallback.
    pub captured_at_is_exact: bool,
    /// The capture date before the owner corrected it, or `None` if never corrected.
    pub captured_at_original: Option<String>,
    pub captured_at_original_is_exact: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub favorite: bool,
    pub archived: bool,
    pub description: Option<String>,
    pub exif: Option<ExifData>,
    #[serde(default, deserialize_with = "deserialize_location")]
    pub location: Option<GeoPoint>,
    /// Dominant colour of the thumbnail, for grid placeholders.
    pub placeholder_color: Option<String>,
    /// The paired video of an iPhone Live Photo, if this asset has one.
    pub live_photo_video_id: Option<String>,
    /// Client-supplied stable id, used by mobile apps to avoid re-uploading.
    pub device_asset_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
    /// Puts back the date the file was imported with, discarding any correction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_captured_at: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<Option<GeoPoint>>,
}

/// Metadata a client may attach at upload time. All fields are hints; EXIF wins where it
/// has an opinion.
///
/// `description` and `location` are here so an importer carrying metadata from somewhere
/// else — a Google Takeout sidecar, say — can land a photograph complete in one request
/// rather than an upload followed by a patch for every file it moves.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetUploadMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_asset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<GeoPoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetUploadResult {
    pub asset: Asset,
    /// True when the checksum already existed and no new file was stored.
    pub duplicate: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPage {
    pub items: Vec<Asset>,
    pub next_cursor: Option<String>,
    /// Total matching rows, when cheap to compute. `None` means "not counted".
    pub total: Option<u64>,
}

// --- queries ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssetSort {
    CapturedAt,
    CreatedAt,
    Filename,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    Asc,
    Desc,
}

/// Cursor pagination. Offsets are wrong for a timeline that grows while you scroll:
/// an upload shifts every later page by one.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AssetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    /// Free-text over filename, description, camera, and place.
    pub q: Option<String>,
    pub r#type: Option<AssetType>,
    pub album_id: Option<String>,
    pub person_id: Option<String>,
    pub favorite: Option<bool>,
    pub archived: Option<bool>,
    /// When true, returns only trashed assets. Trashed assets are hidden otherwise.
    pub trashed: Option<bool>,
    pub taken_after: Option<String>,
    pub taken_before: Option<String>,
    /// Bounding box filter: `minLat,minLon,maxLat,maxLon`.
    pub bbox: Option<String>,
    pub sort: Option<AssetSort>,
    pub order: Option<SortOrder>,
}

impl AssetQuery {
    /// Flattened to the query string the API expects. Absent fields are simply absent,
    /// so the server applies its own defaults rather than ours.
    pub fn to_pairs(&self) -> Vec<(String, String)> {
        let mut pairs: Vec<(String, String)> = Vec::new();
        let mut push = |key: &str, value: String| pairs.push((key.to_string(), value));

        if let Some(v) = &self.cursor {
            push("cursor", v.clone());
        }
        if let Some(v) = self.limit {
            push("limit", v.to_string());
        }
        if let Some(v) = &self.q {
            push("q", v.clone());
        }
        if let Some(v) = self.r#type {
            push(
                "type",
                match v {
                    AssetType::Image => "image".into(),
                    AssetType::Video => "video".into(),
                },
            );
        }
        if let Some(v) = &self.album_id {
            push("albumId", v.clone());
        }
        if let Some(v) = &self.person_id {
            push("personId", v.clone());
        }
        if let Some(v) = self.favorite {
            push("favorite", v.to_string());
        }
        if let Some(v) = self.archived {
            push("archived", v.to_string());
        }
        if let Some(v) = self.trashed {
            push("trashed", v.to_string());
        }
        if let Some(v) = &self.taken_after {
            push("takenAfter", v.clone());
        }
        if let Some(v) = &self.taken_before {
            push("takenBefore", v.clone());
        }
        if let Some(v) = &self.bbox {
            push("bbox", v.clone());
        }
        if let Some(v) = self.sort {
            push(
                "sort",
                match v {
                    AssetSort::CapturedAt => "capturedAt".into(),
                    AssetSort::CreatedAt => "createdAt".into(),
                    AssetSort::Filename => "filename".into(),
                },
            );
        }
        if let Some(v) = self.order {
            push(
                "order",
                match v {
                    SortOrder::Asc => "asc".into(),
                    SortOrder::Desc => "desc".into(),
                },
            );
        }
        pairs
    }
}

/// A day bucket in the timeline, used to size the scroller before assets load.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineBucket {
    pub date: String,
    pub count: u64,
    /// The newest ready asset in the bucket, for an overview card; `None` unless covers were requested.
    #[serde(default)]
    pub cover_asset_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub buckets: Vec<TimelineBucket>,
}

/// The filters every listing shares, so the timeline aggregate, the bucket endpoint, and
/// a by-query selection cannot drift from what `GET /assets` accepts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetFilter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub q: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<AssetType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trashed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub taken_after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub taken_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbox: Option<String>,
}

impl AssetFilter {
    /// Flattened to query pairs the same way [`AssetQuery::to_pairs`] is, so the two
    /// never disagree about how a filter reaches the wire.
    pub fn to_pairs(&self) -> Vec<(String, String)> {
        let mut pairs: Vec<(String, String)> = Vec::new();
        let mut push = |key: &str, value: String| pairs.push((key.to_string(), value));

        if let Some(v) = &self.q {
            push("q", v.clone());
        }
        if let Some(v) = self.r#type {
            push(
                "type",
                match v {
                    AssetType::Image => "image".into(),
                    AssetType::Video => "video".into(),
                },
            );
        }
        if let Some(v) = &self.album_id {
            push("albumId", v.clone());
        }
        if let Some(v) = &self.person_id {
            push("personId", v.clone());
        }
        if let Some(v) = self.favorite {
            push("favorite", v.to_string());
        }
        if let Some(v) = self.archived {
            push("archived", v.to_string());
        }
        if let Some(v) = self.trashed {
            push("trashed", v.to_string());
        }
        if let Some(v) = &self.taken_after {
            push("takenAfter", v.clone());
        }
        if let Some(v) = &self.taken_before {
            push("takenBefore", v.clone());
        }
        if let Some(v) = &self.bbox {
            push("bbox", v.clone());
        }
        pairs
    }
}

/// The filter behind `GET /assets/timeline`, plus whether to resolve a cover photo per bucket.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TimelineQuery {
    pub covers: Option<bool>,
    pub filter: AssetFilter,
}

impl TimelineQuery {
    pub fn to_pairs(&self) -> Vec<(String, String)> {
        let mut pairs = self.filter.to_pairs();
        if let Some(v) = self.covers {
            pairs.push(("covers".to_string(), v.to_string()));
        }
        pairs
    }
}

/// Everything a grid tile draws, and nothing else — far lighter than a full [`Asset`] over
/// a heavy month of scrubbing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineTile {
    pub id: String,
    pub captured_at: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub r#type: AssetType,
    pub status: AssetStatus,
    pub favorite: bool,
    pub duration: Option<f64>,
    pub placeholder_color: Option<String>,
    pub live_photo_video_id: Option<String>,
}

/// One page of tiles, the same shape as [`AssetPage`] but for the lighter timeline type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TilePage {
    pub items: Vec<TimelineTile>,
    pub next_cursor: Option<String>,
    pub total: Option<u64>,
}

/// The query behind one page of `GET /assets/timeline/bucket`; `limit` is left unset so
/// the server's default of 5000 applies rather than a client-side guess.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TimelineBucketQuery {
    pub period: String,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub filter: AssetFilter,
}

impl TimelineBucketQuery {
    pub fn to_pairs(&self) -> Vec<(String, String)> {
        let mut pairs = vec![("period".to_string(), self.period.clone())];
        if let Some(v) = &self.cursor {
            pairs.push(("cursor".to_string(), v.clone()));
        }
        if let Some(v) = self.limit {
            pairs.push(("limit".to_string(), v.to_string()));
        }
        pairs.extend(self.filter.to_pairs());
        pairs
    }
}

/// What a bulk mutation acts on: an explicit id list, or the filter a "select all" reduces
/// to rather than a hundred thousand ids in a request body.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetSelection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<AssetFilter>,
    /// Capped deliberately: past this, an interface should not be offering a selection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub except: Option<Vec<String>>,
}

impl AssetSelection {
    /// The older, shorter way of saying the same thing: a plain id list.
    pub fn ids(asset_ids: &[String]) -> Self {
        Self {
            asset_ids: Some(asset_ids.to_vec()),
            ..Default::default()
        }
    }

    /// Why this selection cannot be sent, or `Ok(())` when it can. Every method that
    /// sends one checks it first, so a client learns of a contradictory selection here
    /// rather than from a 400 after the request has gone.
    pub fn validate(&self) -> crate::error::Result<()> {
        if self.asset_ids.is_none() == self.query.is_none() {
            return Err(crate::error::Error::Invalid(
                "Provide exactly one of assetIds or query".to_string(),
            ));
        }
        // `except` narrows a filter; beside an explicit list it is a contradiction, and
        // the server's id branch never reads it — so honouring the request would act on
        // the very photographs the caller excluded. Rejecting matches the cap rule: a
        // destructive action silently narrowed is undetectable until somebody goes
        // looking for a picture that is no longer there.
        if self.asset_ids.is_some() && self.except.is_some() {
            return Err(crate::error::Error::Invalid(
                "except narrows a query selection only; with assetIds, leave the unwanted ids out of the list"
                    .to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub asset_count: u64,
    pub image_count: u64,
    pub video_count: u64,
    pub album_count: u64,
    pub favorite_count: u64,
    pub trashed_count: u64,
    pub storage_bytes: u64,
    pub earliest_captured_at: Option<String>,
    pub latest_captured_at: Option<String>,
}

// --- albums ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub id: String,
    pub owner_id: String,
    pub name: String,
    pub description: Option<String>,
    pub cover_asset_id: Option<String>,
    pub asset_count: u64,
    pub created_at: String,
    pub updated_at: String,
    /// Set when the album has an active public share link.
    pub share_slug: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumWithAssets {
    #[serde(flatten)]
    pub album: Album,
    pub assets: Vec<Asset>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumCreate {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_asset_id: Option<Option<String>>,
}

/// Adding assets is idempotent, so the result reports what actually changed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumAssetsResult {
    pub added: u64,
    pub skipped: u64,
    pub asset_count: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedCount {
    pub removed: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedCount {
    pub moved: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedCount {
    pub count: u64,
}

// --- sharing ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareLink {
    pub slug: String,
    pub url: String,
    /// Exactly one of these is set: a link points at an album or at one photograph.
    pub album_id: Option<String>,
    pub asset_id: Option<String>,
    pub expires_at: Option<String>,
    pub allow_download: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareLinkCreate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<Option<String>>,
    pub allow_download: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<Option<String>>,
}

impl Default for ShareLinkCreate {
    fn default() -> Self {
        Self {
            expires_at: None,
            allow_download: true,
            password: None,
        }
    }
}

// --- uploads ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSessionCreate {
    pub filename: String,
    pub size_bytes: u64,
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_asset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<GeoPoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSession {
    pub id: String,
    /// Bytes already stored. A resuming client PATCHes from this offset.
    pub offset: u64,
    pub size_bytes: u64,
    pub expires_at: String,
    /// Set when the server recognised the checksum and no upload is needed.
    pub existing: Option<AssetUploadResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadOffset {
    pub offset: u64,
}

pub const BULK_UPLOAD_CONCURRENCY: usize = 6;
/// Files at or above this size use the resumable protocol.
pub const RESUMABLE_THRESHOLD_BYTES: u64 = 64 * 1024 * 1024;
pub const UPLOAD_CHUNK_BYTES: u64 = 8 * 1024 * 1024;

// --- auth ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Admin,
    User,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub role: UserRole,
    pub avatar_url: Option<String>,
    /// Present when the account is linked to an external identity provider.
    pub oidc_subject: Option<String>,
    /// False for OIDC-only accounts, which have no local password.
    pub has_password: bool,
    pub created_at: String,
    pub quota_bytes: Option<u64>,
    pub used_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    /// An invitation token. Admits one account to a server with sign-up closed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invite: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordChangeRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_password: Option<String>,
    pub new_password: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Required to change the email address on an account that has a password.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_password: Option<String>,
}

/// The identity-provider half of [`AuthConfig`], present only when SSO is configured.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OidcConfig {
    pub enabled: bool,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub start_url: Option<String>,
    /// Where to send someone to edit the details the provider owns, if known.
    #[serde(default)]
    pub account_url: Option<String>,
}

/// What the login page needs in order to render before anyone has authenticated.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
    pub allow_signup: bool,
    /// True until the first account exists; the first signup becomes the admin.
    pub needs_setup: bool,
    pub oidc: OidcConfig,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub status: String,
    pub version: String,
}

// --- OAuth 2.1 ---

pub const DEFAULT_SCOPES: [&str; 4] = [
    "library:read",
    "library:write",
    "albums:read",
    "albums:write",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClientRegistrationResponse {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    #[serde(default)]
    pub client_id_issued_at: i64,
    #[serde(default)]
    pub client_secret_expires_at: i64,
    #[serde(default)]
    pub client_name: Option<String>,
    #[serde(default)]
    pub redirect_uris: Vec<String>,
    #[serde(default)]
    pub grant_types: Vec<String>,
    #[serde(default)]
    pub response_types: Vec<String>,
    #[serde(default)]
    pub token_endpoint_auth_method: String,
    #[serde(default)]
    pub scope: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub scope: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuthorizationServerMetadata {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    #[serde(default)]
    pub registration_endpoint: String,
    #[serde(default)]
    pub revocation_endpoint: String,
    #[serde(default)]
    pub scopes_supported: Vec<String>,
    #[serde(default)]
    pub code_challenge_methods_supported: Vec<String>,
}

/// RFC 9728 protected resource metadata.
///
/// `resource` is the identifier to echo back as the RFC 8707 `resource` parameter. The
/// server compares it against the single spelling it publishes here, so a client that
/// rebuilds the string from its own base URL can produce a near-miss — a stray port, a
/// trailing slash — that comes back as `invalid_target`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProtectedResourceMetadata {
    pub resource: String,
    #[serde(default)]
    pub authorization_servers: Vec<String>,
    #[serde(default)]
    pub scopes_supported: Vec<String>,
    #[serde(default)]
    pub bearer_methods_supported: Vec<String>,
    #[serde(default)]
    pub resource_documentation: String,
}

// --- pairing ---

/// A ticket a signed-in browser makes so a device does not have to be told where the
/// server is. See [`crate::Pairing`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingTicket {
    pub id: String,
    /// The one-time secret. Legible only in the response that created the ticket.
    pub code: String,
    pub server_url: String,
    /// Server and secret in one string — this is what goes into the QR code.
    pub uri: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingStatus {
    pub id: String,
    pub expires_at: String,
    /// None until a device takes the ticket.
    #[serde(default)]
    pub claimed_at: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingClaimRequest {
    pub code: String,
    /// The client the device registered for itself through RFC 7591.
    pub client_id: String,
    pub redirect_uri: String,
    pub code_challenge: String,
    pub code_challenge_method: String,
    /// Space-separated. None to take everything a paired device is allowed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// Shown to whoever made the ticket, and in the connected-applications list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_name: Option<String>,
    /// RFC 8707. The resource this device's token is for, recorded on the code the claim
    /// mints so the exchange is bound to it just as a browser-flow code would be. `None`
    /// for a token good at every surface, which is what every device paired before this
    /// existed already holds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
}

impl PairingClaimRequest {
    pub fn new(
        code: impl Into<String>,
        client_id: impl Into<String>,
        redirect_uri: impl Into<String>,
        code_challenge: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            client_id: client_id.into(),
            redirect_uri: redirect_uri.into(),
            code_challenge: code_challenge.into(),
            code_challenge_method: "S256".into(),
            scope: None,
            device_name: None,
            resource: None,
        }
    }
}

/// An ordinary authorization code. Exchange it at the token endpoint with the verifier
/// that produced the challenge; on its own it grants nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingClaim {
    pub code: String,
    pub redirect_uri: String,
    pub scope: String,
}

/// The scheme an application registers so `imogen://pair?…` opens it.
pub const PAIRING_URI_SCHEME: &str = "imogen";

// --- people ---

/// One cluster of faces the library believes belong to the same person.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    /// `None` until somebody names them. An unnamed person is still browsable.
    pub name: Option<String>,
    pub cover_face_id: Option<String>,
    pub photo_count: u64,
    pub hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonWithPhotos {
    #[serde(flatten)]
    pub person: Person,
    pub photos: Vec<Asset>,
}

/// Where a face sits in its photo, in the original image's pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedFace {
    pub id: String,
    pub asset_id: String,
    pub person_id: Option<String>,
    /// `None` when this person has not been named yet.
    pub person_name: Option<String>,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    pub score: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceModel {
    pub name: String,
    pub present: bool,
    pub bytes: u64,
    pub expected_bytes: u64,
}

/// What the settings screen needs to describe the feature's state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceStatus {
    pub enabled: bool,
    /// False until the models have been downloaded onto the server.
    pub models_ready: bool,
    pub models: Vec<FaceModel>,
    pub people_count: u64,
    /// Photos still waiting to be scanned.
    pub pending: u64,
}

// --- vault ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub configured: bool,
    pub unlocked: bool,
    /// Only present while unlocked: a locked vault does not reveal its size.
    #[serde(default)]
    pub count: Option<u64>,
}

// --- administration ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SignsInWith {
    Password,
    Sso,
    Both,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUser {
    pub id: String,
    pub email: String,
    pub name: String,
    pub role: UserRole,
    /// How this account signs in. An SSO account has no password to reset.
    pub signs_in_with: SignsInWith,
    /// Suspended: the rows are all still here, but nobody can sign in as them.
    pub disabled: bool,
    pub photo_count: u64,
    pub used_bytes: u64,
    /// `None` when the account draws on whatever the server has.
    pub quota_bytes: Option<u64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<UserRole>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InviteState {
    Pending,
    Accepted,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub id: String,
    pub email: Option<String>,
    pub role: UserRole,
    pub created_at: String,
    pub expires_at: String,
    pub accepted_at: Option<String>,
    pub state: InviteState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteCreate {
    /// When set, only this address may use the link.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<Option<String>>,
    pub role: UserRole,
    pub expires_in_days: u32,
}

impl Default for InviteCreate {
    fn default() -> Self {
        Self {
            email: None,
            role: UserRole::User,
            expires_in_days: 7,
        }
    }
}

/// The one and only time the token is legible.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteCreated {
    #[serde(flatten)]
    pub invite: Invite,
    pub token: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminJob {
    pub id: String,
    pub name: String,
    pub status: JobStatus,
    pub attempts: u32,
    pub max_attempts: u32,
    pub last_error: Option<String>,
    pub run_at: String,
    pub created_at: String,
    pub finished_at: Option<String>,
}

/// `stuck` counts photographs the pipeline never finished with. Without it a failed
/// transcode leaves a photo saying "processing" for ever and nothing says why.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueHealth {
    pub queued: u64,
    pub running: u64,
    pub failed: u64,
    pub stuck: u64,
    /// The oldest thing still waiting, so a jammed queue is obvious.
    pub oldest_queued_at: Option<String>,
    pub failures: Vec<AdminJob>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminClient {
    pub id: String,
    pub name: String,
    pub redirect_uris: Vec<String>,
    pub scopes: Vec<String>,
    /// With RFC 7591 open, anything that asks gets a client. This separates what an
    /// administrator set up deliberately from what simply turned up.
    pub dynamically_registered: bool,
    /// Public clients hold no secret and rely on PKCE. Native apps and MCP are these.
    pub is_public: bool,
    pub created_at: String,
    pub active_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminSession {
    pub id: String,
    pub user_id: String,
    pub user_email: String,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: String,
    pub last_used_at: String,
    pub expires_at: String,
    /// True for the session making this request, so it is not revoked by accident.
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePerUser {
    pub user_id: String,
    pub email: String,
    pub used_bytes: u64,
    pub photo_count: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageReport {
    pub data_dir: String,
    pub original_bytes: u64,
    pub derivative_bytes: u64,
    pub trashed_count: u64,
    pub trashed_bytes: u64,
    pub trash_retention_days: u32,
    /// The next thing due to be destroyed, so the sweep is not a black box.
    pub next_sweep_at: Option<String>,
    /// Rows whose file is missing. Counted rather than listed.
    pub missing_files: u64,
    pub per_user: Vec<StoragePerUser>,
}

/// Settings that can be changed without restarting the server. What is stored wins over
/// the environment, so a deployment that sets nothing keeps behaving as it did.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSettings {
    pub allow_signup: bool,
    pub trash_retention_days: u32,
    pub faces_enabled: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSettingsUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_signup: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trash_retention_days: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub faces_enabled: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShareKind {
    Album,
    Photo,
}

/// A public link, named by what it points at rather than by its slug: an administrator
/// deciding whether something should still be public is asking what it is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminShareLink {
    pub id: String,
    pub slug: String,
    pub url: String,
    pub kind: ShareKind,
    /// The album's name, or the photograph's filename.
    pub target: String,
    pub created_by_email: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub has_password: bool,
    pub allow_download: bool,
}

// --- error envelope ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    /// Field-level detail for validation failures: path -> messages.
    #[serde(default)]
    pub details: Option<BTreeMap<String, Vec<String>>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApiError {
    pub error: ApiErrorBody,
}

/// A page of anything the API returns as `{ items }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Items<T> {
    pub items: Vec<T>,
}
