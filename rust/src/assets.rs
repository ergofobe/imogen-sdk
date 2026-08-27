use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures::stream::{self, StreamExt, TryStreamExt};
use reqwest::Method;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::error::{Error, Result};
use crate::http::{HttpClient, RequestOptions};
use crate::models::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadProgress {
    /// Bytes transferred so far for this file.
    pub loaded: u64,
    pub total: u64,
}

pub type ProgressFn = Arc<dyn Fn(UploadProgress) + Send + Sync>;
/// Supplies per-file metadata during a bulk upload.
pub type MetadataFn = Arc<dyn Fn(&Path) -> AssetUploadMetadata + Send + Sync>;

#[derive(Default, Clone)]
pub struct UploadOptions {
    pub metadata: AssetUploadMetadata,
    pub on_progress: Option<ProgressFn>,
}

impl UploadOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn metadata(mut self, metadata: AssetUploadMetadata) -> Self {
        self.metadata = metadata;
        self
    }

    pub fn on_progress(mut self, f: ProgressFn) -> Self {
        self.on_progress = Some(f);
        self
    }
}

/// The outcome of one file in a bulk upload. Each settles independently, so one bad
/// photo in a folder of three thousand does not abandon the rest.
#[derive(Debug)]
pub struct BulkUploadResult {
    pub path: PathBuf,
    pub result: std::result::Result<AssetUploadResult, Error>,
}

#[derive(Clone)]
pub struct BulkUploadOptions {
    pub concurrency: usize,
    pub metadata_for: Option<MetadataFn>,
}

impl Default for BulkUploadOptions {
    fn default() -> Self {
        Self {
            concurrency: BULK_UPLOAD_CONCURRENCY,
            metadata_for: None,
        }
    }
}

pub struct Assets {
    http: Arc<HttpClient>,
}

impl Assets {
    pub(crate) fn new(http: Arc<HttpClient>) -> Self {
        Self { http }
    }

    pub async fn list(&self, query: &AssetQuery) -> Result<AssetPage> {
        self.http
            .request(
                Method::GET,
                "/api/v1/assets",
                RequestOptions::query(query.to_pairs()),
            )
            .await
    }

    /// Walks every page, so a caller can stream the whole library. The cursor is carried
    /// in the unfold state: a page that reports no next cursor ends the stream.
    pub fn iterate(&self, query: &AssetQuery) -> impl futures::Stream<Item = Result<Asset>> + '_ {
        stream::try_unfold(Some(query.clone()), move |state| async move {
            let Some(mut query) = state else {
                return Ok(None);
            };
            let page = self.list(&query).await?;
            let next = match &page.next_cursor {
                Some(cursor) => {
                    query.cursor = Some(cursor.clone());
                    Some(query)
                }
                None => None,
            };
            let items = stream::iter(page.items.into_iter().map(Ok));
            Ok::<_, Error>(Some((items, next)))
        })
        .try_flatten()
    }

    /// Collects the whole library into memory. Prefer [`Assets::iterate`] for a big one.
    pub async fn list_all(&self, query: &AssetQuery) -> Result<Vec<Asset>> {
        let mut query = query.clone();
        let mut all = Vec::new();
        loop {
            let page = self.list(&query).await?;
            all.extend(page.items);
            match page.next_cursor {
                Some(cursor) => query.cursor = Some(cursor),
                None => return Ok(all),
            }
        }
    }

    pub async fn get(&self, asset_id: &str) -> Result<Asset> {
        self.http
            .request(
                Method::GET,
                &format!("/api/v1/assets/{asset_id}"),
                RequestOptions::default(),
            )
            .await
    }

    pub async fn update(&self, asset_id: &str, patch: &AssetUpdate) -> Result<Asset> {
        self.http
            .request(
                Method::PATCH,
                &format!("/api/v1/assets/{asset_id}"),
                RequestOptions::json(patch)?,
            )
            .await
    }

    /// The live public link for one photo, or `None`.
    pub async fn share_link(&self, asset_id: &str) -> Result<Option<ShareLink>> {
        self.http
            .request(
                Method::GET,
                &format!("/api/v1/assets/{asset_id}/share"),
                RequestOptions::default(),
            )
            .await
    }

    /// Publishes one photo. Replaces any existing link for it.
    pub async fn share(&self, asset_id: &str, input: &ShareLinkCreate) -> Result<ShareLink> {
        self.http
            .request(
                Method::POST,
                &format!("/api/v1/assets/{asset_id}/share"),
                RequestOptions::json(input)?,
            )
            .await
    }

    pub async fn unshare(&self, asset_id: &str) -> Result<()> {
        self.http
            .request::<Option<serde_json::Value>>(
                Method::DELETE,
                &format!("/api/v1/assets/{asset_id}/share"),
                RequestOptions::default(),
            )
            .await?;
        Ok(())
    }

    pub async fn trash(&self, selection: &AssetSelection) -> Result<AffectedCount> {
        self.http
            .request(
                Method::POST,
                "/api/v1/assets/trash",
                RequestOptions::json(selection)?,
            )
            .await
    }

    pub async fn restore(&self, selection: &AssetSelection) -> Result<AffectedCount> {
        self.http
            .request(
                Method::POST,
                "/api/v1/assets/restore",
                RequestOptions::json(selection)?,
            )
            .await
    }

    pub async fn timeline(&self, query: &TimelineQuery) -> Result<Timeline> {
        self.http
            .request(
                Method::GET,
                "/api/v1/assets/timeline",
                RequestOptions::query(query.to_pairs()),
            )
            .await
    }

    /// Every tile in one period, in one round trip, for a grid that lays itself out.
    /// `query.limit` is left unset so the server's own default applies.
    pub async fn timeline_bucket(&self, query: &TimelineBucketQuery) -> Result<TilePage> {
        self.http
            .request(
                Method::GET,
                "/api/v1/assets/timeline/bucket",
                RequestOptions::query(query.to_pairs()),
            )
            .await
    }

    pub async fn stats(&self) -> Result<LibraryStats> {
        self.http
            .request(
                Method::GET,
                "/api/v1/assets/stats",
                RequestOptions::default(),
            )
            .await
    }

    /// A URL suitable for an image view. Browsers send the session cookie themselves.
    pub fn url_for(&self, asset_id: &str, variant: AssetVariant) -> String {
        self.http
            .url_string(&format!("/api/v1/assets/{asset_id}/{}", variant.as_str()))
    }

    pub fn download_url(&self, asset_id: &str) -> String {
        self.http
            .url_string(&format!("/api/v1/assets/{asset_id}/download"))
    }

    /// Fetches image bytes with an Authorization header, for non-browser clients.
    pub async fn bytes(&self, asset_id: &str, variant: AssetVariant) -> Result<Vec<u8>> {
        let response = self
            .http
            .send(
                Method::GET,
                &format!("/api/v1/assets/{asset_id}/{}", variant.as_str()),
                RequestOptions::default(),
            )
            .await?;
        Ok(response.bytes().await?.to_vec())
    }

    /// Streams one variant to a file, so a two-gigabyte video never sits in memory.
    ///
    /// Writes to a sibling `.part` and renames on success: an interrupted download leaves
    /// no file that looks finished.
    pub async fn download_to(
        &self,
        asset_id: &str,
        variant: AssetVariant,
        destination: &Path,
        on_progress: Option<&ProgressFn>,
    ) -> Result<u64> {
        let path = match variant {
            AssetVariant::Original => format!("/api/v1/assets/{asset_id}/download"),
            _ => format!("/api/v1/assets/{asset_id}/{}", variant.as_str()),
        };
        let response = self
            .http
            .send(Method::GET, &path, RequestOptions::default())
            .await?;

        let total = response.content_length().unwrap_or(0);
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let partial = destination.with_extension(format!(
            "{}part",
            destination
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| format!("{e}."))
                .unwrap_or_default()
        ));

        let mut file = tokio::fs::File::create(&partial).await?;
        let mut loaded = 0u64;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(Error::Transport)?;
            file.write_all(&chunk).await?;
            loaded += chunk.len() as u64;
            if let Some(report) = on_progress {
                report(UploadProgress {
                    loaded,
                    total: total.max(loaded),
                });
            }
        }
        file.flush().await?;
        drop(file);
        tokio::fs::rename(&partial, destination).await?;
        Ok(loaded)
    }

    /// Uploads one file, choosing the protocol by size: small files go in a single
    /// request, large ones use a resumable session so a dropped connection costs one
    /// chunk rather than the whole video.
    pub async fn upload(&self, path: &Path, options: &UploadOptions) -> Result<AssetUploadResult> {
        let size = tokio::fs::metadata(path).await?.len();
        if size >= RESUMABLE_THRESHOLD_BYTES {
            return self.upload_resumable(path, size, options).await;
        }

        // The contract lets a client name the file something other than what it is called
        // on disk — an importer restoring a name the export truncated, for instance.
        let filename = options
            .metadata
            .filename
            .clone()
            .unwrap_or_else(|| file_name(path));
        let mime = mime_for(path);
        let bytes = tokio::fs::read(path).await?;

        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(filename)
            .mime_str(&mime)
            .map_err(Error::Transport)?;
        let mut form = reqwest::multipart::Form::new().part("file", part);

        if let Some(v) = &options.metadata.device_asset_id {
            form = form.text("deviceAssetId", v.clone());
        }
        if let Some(v) = &options.metadata.captured_at {
            form = form.text("capturedAt", v.clone());
        }
        if let Some(v) = options.metadata.favorite {
            form = form.text("favorite", v.to_string());
        }
        if let Some(v) = &options.metadata.description {
            form = form.text("description", v.clone());
        }
        if let Some(v) = &options.metadata.location {
            form = form.text("location", serde_json::to_string(v)?);
        }
        if let Some(v) = &options.metadata.filename {
            form = form.text("filename", v.clone());
        }

        let result: AssetUploadResult = self
            .http
            .request(
                Method::POST,
                "/api/v1/assets",
                RequestOptions {
                    form: Some(form),
                    ..Default::default()
                },
            )
            .await?;

        if let Some(report) = &options.on_progress {
            report(UploadProgress {
                loaded: size,
                total: size,
            });
        }
        Ok(result)
    }

    async fn upload_resumable(
        &self,
        path: &Path,
        size: u64,
        options: &UploadOptions,
    ) -> Result<AssetUploadResult> {
        let create = UploadSessionCreate {
            filename: options
                .metadata
                .filename
                .clone()
                .unwrap_or_else(|| file_name(path)),
            size_bytes: size,
            mime_type: mime_for(path),
            checksum: None,
            device_asset_id: options.metadata.device_asset_id.clone(),
            captured_at: options.metadata.captured_at.clone(),
            favorite: options.metadata.favorite,
            description: options.metadata.description.clone(),
            location: options.metadata.location.clone(),
        };

        let session: UploadSession = self
            .http
            .request(
                Method::POST,
                "/api/v1/uploads",
                RequestOptions::json(&create)?,
            )
            .await?;

        // The server already had these bytes; nothing to transfer.
        if let Some(existing) = session.existing {
            if let Some(report) = &options.on_progress {
                report(UploadProgress {
                    loaded: size,
                    total: size,
                });
            }
            return Ok(existing);
        }

        let mut file = tokio::fs::File::open(path).await?;
        let mut offset = session.offset;

        while offset < size {
            let end = (offset + UPLOAD_CHUNK_BYTES).min(size);
            let len = (end - offset) as usize;

            file.seek(std::io::SeekFrom::Start(offset)).await?;
            let mut chunk = vec![0u8; len];
            file.read_exact(&mut chunk).await?;

            let response = self
                .http
                .send(
                    Method::PATCH,
                    &format!("/api/v1/uploads/{}", session.id),
                    RequestOptions {
                        raw: Some(chunk),
                        headers: vec![
                            ("Upload-Offset".into(), offset.to_string()),
                            ("Content-Type".into(), "application/octet-stream".into()),
                        ],
                        ..Default::default()
                    },
                )
                .await?;

            let progress: UploadOffset = serde_json::from_str(&response.text().await?)?;
            offset = progress.offset;

            if let Some(report) = &options.on_progress {
                report(UploadProgress {
                    loaded: offset,
                    total: size,
                });
            }
        }

        self.http
            .request(
                Method::POST,
                &format!("/api/v1/uploads/{}/complete", session.id),
                RequestOptions::default(),
            )
            .await
    }

    /// Uploads many files with bounded concurrency.
    pub async fn upload_many(
        &self,
        paths: &[PathBuf],
        options: &BulkUploadOptions,
    ) -> Vec<BulkUploadResult> {
        let concurrency = options.concurrency.max(1);

        stream::iter(paths.iter().cloned())
            .map(|path| {
                let metadata = options
                    .metadata_for
                    .as_ref()
                    .map(|f| f(&path))
                    .unwrap_or_default();
                async move {
                    let upload = UploadOptions {
                        metadata,
                        on_progress: None,
                    };
                    BulkUploadResult {
                        result: self.upload(&path, &upload).await,
                        path,
                    }
                }
            })
            .buffer_unordered(concurrency)
            .collect()
            .await
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("upload")
        .to_string()
}

/// Enough of a guess for the server to accept the part. The server re-sniffs the bytes
/// anyway, so this never becomes the last word on what a file is.
fn mime_for(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "avif" => "image/avif",
        "tif" | "tiff" => "image/tiff",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        _ => "application/octet-stream",
    }
    .to_string()
}
