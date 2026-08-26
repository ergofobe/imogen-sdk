use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use url::Url;

use crate::error::{Error, Result};
use crate::models::{AuthorizationServerMetadata, ClientRegistrationResponse, TokenResponse};

/// Hold these until the redirect comes back; they complete the exchange.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingAuthorization {
    pub authorization_url: String,
    pub code_verifier: String,
    pub state: String,
    pub redirect_uri: String,
    pub client_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredTokens {
    pub tokens: TokenResponse,
    /// Unix milliseconds, so expiry is computable without keeping the clock that read it.
    pub obtained_at: u128,
}

impl StoredTokens {
    /// True when the access token is expired or close enough that it should be refreshed.
    pub fn is_expired(&self, skew_seconds: i64) -> bool {
        let lifetime = (self.tokens.expires_in - skew_seconds).max(0) as u128 * 1000;
        now_millis() >= self.obtained_at + lifetime
    }
}

/// The OAuth 2.1 client a native application needs: discover the server, register itself,
/// run authorization code with PKCE, and refresh. No client secret is involved, because a
/// secret shipped inside a mobile app is not a secret.
///
/// ```no_run
/// # async fn run() -> imogen_sdk::Result<()> {
/// let oauth = imogen_sdk::OAuthClient::new("https://photos.example.com");
/// let client = oauth.register("My Photo App", &["myapp://oauth".into()], None).await?;
/// let pending = oauth.begin_authorization(&client.client_id, "myapp://oauth", None).await?;
/// // open pending.authorization_url in the system browser, then on the callback:
/// let tokens = oauth.complete_authorization(&pending, "myapp://oauth?code=...").await?;
/// # Ok(())
/// # }
/// ```
pub struct OAuthClient {
    base_url: String,
    http: reqwest::Client,
    metadata: Arc<Mutex<Option<AuthorizationServerMetadata>>>,
}

impl OAuthClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self::with_client(base_url, reqwest::Client::new())
    }

    pub fn with_client(base_url: impl Into<String>, http: reqwest::Client) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            http,
            metadata: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn discover(&self) -> Result<AuthorizationServerMetadata> {
        if let Some(cached) = self.metadata.lock().await.clone() {
            return Ok(cached);
        }

        let url = format!("{}/.well-known/oauth-authorization-server", self.base_url);
        let response = self.http.get(url).send().await?;
        if !response.status().is_success() {
            return Err(Error::Oauth(
                "Could not read the authorization server metadata".into(),
            ));
        }

        let metadata: AuthorizationServerMetadata = serde_json::from_str(&response.text().await?)?;
        *self.metadata.lock().await = Some(metadata.clone());
        Ok(metadata)
    }

    /// RFC 7591 dynamic registration, so an app never ships a hard-coded client id.
    pub async fn register(
        &self,
        name: &str,
        redirect_uris: &[String],
        scopes: Option<&[String]>,
    ) -> Result<ClientRegistrationResponse> {
        let metadata = self.discover().await?;
        let scope = scope_string(scopes);

        let response = self
            .http
            .post(&metadata.registration_endpoint)
            .json(&serde_json::json!({
                "client_name": name,
                "redirect_uris": redirect_uris,
                "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "scope": scope,
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(Error::Oauth(format!("Registration failed: {body}")));
        }
        Ok(serde_json::from_str(&response.text().await?)?)
    }

    pub async fn begin_authorization(
        &self,
        client_id: &str,
        redirect_uri: &str,
        scopes: Option<&[String]>,
    ) -> Result<PendingAuthorization> {
        let metadata = self.discover().await?;
        let code_verifier = random_string(32);
        let state = random_string(16);

        let mut url = Url::parse(&metadata.authorization_endpoint)?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("response_type", "code");
            pairs.append_pair("client_id", client_id);
            pairs.append_pair("redirect_uri", redirect_uri);
            pairs.append_pair("scope", &scope_string(scopes));
            pairs.append_pair("state", &state);
            pairs.append_pair("code_challenge", &s256(&code_verifier));
            pairs.append_pair("code_challenge_method", "S256");
        }

        Ok(PendingAuthorization {
            authorization_url: url.to_string(),
            code_verifier,
            state,
            redirect_uri: redirect_uri.to_string(),
            client_id: client_id.to_string(),
        })
    }

    pub async fn complete_authorization(
        &self,
        pending: &PendingAuthorization,
        callback_url: &str,
    ) -> Result<StoredTokens> {
        let url = Url::parse(callback_url)?;
        let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();

        if let Some(error) = params.get("error") {
            let described = params
                .get("error_description")
                .cloned()
                .unwrap_or_else(|| format!("Authorization failed: {error}"));
            return Err(Error::Oauth(described));
        }
        // Checking state is what stops a code from another session being injected here.
        if params.get("state").map(String::as_str) != Some(pending.state.as_str()) {
            return Err(Error::Oauth(
                "Authorization state did not match; the response may have been tampered with"
                    .into(),
            ));
        }
        let Some(code) = params.get("code") else {
            return Err(Error::Oauth(
                "The callback carried no authorization code".into(),
            ));
        };

        self.exchange(&[
            ("grant_type", "authorization_code"),
            ("client_id", &pending.client_id),
            ("code", code),
            ("code_verifier", &pending.code_verifier),
            ("redirect_uri", &pending.redirect_uri),
        ])
        .await
    }

    pub async fn refresh(&self, client_id: &str, refresh_token: &str) -> Result<StoredTokens> {
        self.exchange(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
        ])
        .await
    }

    pub async fn revoke(&self, token: &str) -> Result<()> {
        let metadata = self.discover().await?;
        self.http
            .post(&metadata.revocation_endpoint)
            .form(&[("token", token)])
            .send()
            .await?;
        Ok(())
    }

    async fn exchange(&self, params: &[(&str, &str)]) -> Result<StoredTokens> {
        let metadata = self.discover().await?;
        let response = self
            .http
            .post(&metadata.token_endpoint)
            .form(params)
            .send()
            .await?;

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            let described = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| {
                    v.get("error_description")
                        .or_else(|| v.get("error"))
                        .and_then(|s| s.as_str())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "Token request failed".into());
            return Err(Error::Oauth(described));
        }

        Ok(StoredTokens {
            tokens: serde_json::from_str(&response.text().await?)?,
            obtained_at: now_millis(),
        })
    }
}

fn scope_string(scopes: Option<&[String]>) -> String {
    match scopes {
        Some(scopes) => scopes.join(" "),
        None => crate::models::DEFAULT_SCOPES.join(" "),
    }
}

fn random_string(byte_length: usize) -> String {
    let mut bytes = vec![0u8; byte_length];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn s256(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
