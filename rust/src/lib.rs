//! Rust client for the [imogen](https://github.com/ergofobe/imogen-server) photo library
//! API.
//!
//! ```no_run
//! use imogen_sdk::{ClientOptions, ImogenClient, AssetQuery};
//!
//! # async fn run() -> imogen_sdk::Result<()> {
//! let imogen = ImogenClient::new(
//!     ClientOptions::new("https://photos.example.com").token("…"),
//! );
//!
//! let page = imogen
//!     .assets
//!     .list(&AssetQuery { q: Some("harbour".into()), limit: Some(50), ..Default::default() })
//!     .await?;
//!
//! for asset in page.items {
//!     println!("{} {}", asset.id, asset.original_filename);
//! }
//! # Ok(())
//! # }
//! ```

mod admin;
mod albums;
mod assets;
mod auth;
mod error;
mod http;
pub mod models;
mod oauth;
mod pairing;
mod people;
mod vault;

use std::sync::Arc;

pub use reqwest::Method;

pub use crate::admin::Admin;
pub use crate::albums::Albums;
pub use crate::assets::{
    Assets, BulkUploadOptions, BulkUploadResult, MetadataFn, ProgressFn, UploadOptions,
    UploadProgress,
};
pub use crate::auth::Auth;
pub use crate::error::{Error, Result};
pub use crate::http::{
    BoxFuture, ClientOptions, HttpClient, RefreshToken, RequestOptions, TokenSource,
    DEFAULT_CONNECT_TIMEOUT,
};
pub use crate::models::*;
pub use crate::oauth::{
    OAuthClient, PairedDevice, PendingAuthorization, ProtectedResourcePath, StoredTokens,
};
pub use crate::pairing::Pairing;
pub use crate::people::People;
pub use crate::vault::Vault;

/// The imogen client.
///
/// In a browser served by imogen itself, omit the token: the session cookie is enough.
pub struct ImogenClient {
    pub http: Arc<HttpClient>,
    pub assets: Assets,
    pub albums: Albums,
    pub admin: Admin,
    pub auth: Auth,
    pub vault: Vault,
    pub people: People,
    pub pairing: Pairing,
}

impl ImogenClient {
    pub fn new(options: ClientOptions) -> Self {
        let http = Arc::new(HttpClient::new(options));
        Self {
            assets: Assets::new(http.clone()),
            albums: Albums::new(http.clone()),
            admin: Admin::new(http.clone()),
            auth: Auth::new(http.clone()),
            vault: Vault::new(http.clone()),
            people: People::new(http.clone()),
            pairing: Pairing::new(http.clone()),
            http,
        }
    }

    pub fn base_url(&self) -> &str {
        self.http.base_url()
    }

    /// Confirms the server is reachable and reports its version.
    pub async fn health(&self) -> Result<Health> {
        self.http
            .request(Method::GET, "/api/v1/health", RequestOptions::default())
            .await
    }
}
