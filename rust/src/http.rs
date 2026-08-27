use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use rand::Rng;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Method, Response};
use serde::de::DeserializeOwned;
use serde::Serialize;
use url::Url;

use crate::error::{Error, Result};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Supplies a bearer token. Implemented for `String`, so the common case stays a literal;
/// implement it yourself when the token lives behind a keychain or a refresh loop.
pub trait TokenSource: Send + Sync {
    fn token(&self) -> BoxFuture<'_, Option<String>>;
}

impl TokenSource for String {
    fn token(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move { Some(self.clone()) })
    }
}

/// Called when the server rejects a token, so an app can refresh and retry once.
pub trait RefreshToken: Send + Sync {
    fn refresh(&self) -> BoxFuture<'_, Option<String>>;
}

/// How long to wait for a connection before giving up on one address and moving on.
///
/// reqwest leaves this unset, which means the operating system's own limit — over a
/// minute on macOS. A host with a AAAA record on a network where IPv6 silently blackholes
/// then hangs for that long, and the retry policy below multiplies it. Ten seconds is far
/// longer than any working connection needs and short enough that a dead address is
/// abandoned while somebody is still watching.
pub const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub struct ClientOptions {
    /// Where imogen lives, e.g. `https://photos.example.com`.
    pub base_url: String,
    pub token: Option<Arc<dyn TokenSource>>,
    pub on_unauthorized: Option<Arc<dyn RefreshToken>>,
    /// How many times to retry a request that failed for a transient reason.
    pub max_retries: u32,
    /// How long to wait for a connection. `None` leaves it to the operating system.
    pub connect_timeout: Option<Duration>,
    pub http: Option<reqwest::Client>,
}

impl ClientOptions {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            token: None,
            on_unauthorized: None,
            max_retries: 2,
            connect_timeout: Some(DEFAULT_CONNECT_TIMEOUT),
            http: None,
        }
    }

    pub fn token(mut self, token: impl Into<String>) -> Self {
        self.token = Some(Arc::new(token.into()));
        self
    }

    pub fn token_source(mut self, source: Arc<dyn TokenSource>) -> Self {
        self.token = Some(source);
        self
    }

    pub fn on_unauthorized(mut self, refresh: Arc<dyn RefreshToken>) -> Self {
        self.on_unauthorized = Some(refresh);
        self
    }

    pub fn max_retries(mut self, retries: u32) -> Self {
        self.max_retries = retries;
        self
    }

    /// Overrides the connection timeout. `None` waits as long as the operating system
    /// does, which on a stalled address can be over a minute.
    pub fn connect_timeout(mut self, timeout: Option<Duration>) -> Self {
        self.connect_timeout = timeout;
        self
    }

    pub fn http_client(mut self, client: reqwest::Client) -> Self {
        self.http = Some(client);
        self
    }
}

/// What a request carries beyond its method and path.
#[derive(Default)]
pub struct RequestOptions {
    pub query: Vec<(String, String)>,
    pub json: Option<serde_json::Value>,
    pub form: Option<reqwest::multipart::Form>,
    /// Raw bytes, for chunked uploads.
    pub raw: Option<Vec<u8>>,
    pub headers: Vec<(String, String)>,
}

impl RequestOptions {
    pub fn json<T: Serialize>(body: &T) -> Result<Self> {
        Ok(Self {
            json: Some(serde_json::to_value(body)?),
            ..Default::default()
        })
    }

    pub fn query(pairs: Vec<(String, String)>) -> Self {
        Self {
            query: pairs,
            ..Default::default()
        }
    }
}

/// The transport every resource shares: URL building, auth, the error envelope, and one
/// retry policy. Resources above this layer contain no HTTP details at all.
pub struct HttpClient {
    base_url: String,
    client: reqwest::Client,
    token: Option<Arc<dyn TokenSource>>,
    on_unauthorized: Option<Arc<dyn RefreshToken>>,
    max_retries: u32,
}

impl HttpClient {
    pub fn new(options: ClientOptions) -> Self {
        // A client supplied by the caller is used exactly as given: they have already
        // decided how it should behave.
        let client = options
            .http
            .unwrap_or_else(|| build_client(options.connect_timeout));
        Self {
            base_url: options.base_url.trim_end_matches('/').to_string(),
            client,
            token: options.token,
            on_unauthorized: options.on_unauthorized,
            max_retries: options.max_retries,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn url(&self, path: &str, query: &[(String, String)]) -> Result<Url> {
        let mut url = Url::parse(&format!("{}{}", self.base_url, path))?;
        if !query.is_empty() {
            let mut pairs = url.query_pairs_mut();
            for (key, value) in query {
                pairs.append_pair(key, value);
            }
        }
        Ok(url)
    }

    /// The URL as a string, for an `<img src>` or a download link.
    pub fn url_string(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    async fn authorization(&self) -> Option<String> {
        let source = self.token.as_ref()?;
        let value = source.token().await?;
        if value.is_empty() {
            return None;
        }
        Some(format!("Bearer {value}"))
    }

    /// Sends, decodes, and hands back the typed body. A 204 decodes as the unit-like
    /// `Empty`, so a caller of a no-content endpoint still gets a `Result`.
    pub async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        options: RequestOptions,
    ) -> Result<T> {
        let response = self.send(method, path, options).await?;
        if response.status().as_u16() == 204 {
            // `serde_json` will turn `null` into `()` or `Option::None` as needed.
            return Ok(serde_json::from_str::<T>("null")?);
        }
        let text = response.text().await?;
        if text.trim().is_empty() {
            return Ok(serde_json::from_str::<T>("null")?);
        }
        Ok(serde_json::from_str::<T>(&text)?)
    }

    /// Sends and hands back the raw response, for bytes rather than JSON.
    pub async fn send(
        &self,
        method: Method,
        path: &str,
        mut options: RequestOptions,
    ) -> Result<Response> {
        let mut last: Option<Error> = None;
        // A multipart form is not clonable, so a request carrying one gets a single
        // attempt: replaying it would mean buffering the whole file to do it.
        let replayable = options.form.is_none();

        for attempt in 0..=self.max_retries {
            let outcome = self.attempt(method.clone(), path, &mut options).await;

            match outcome {
                Ok(response) => {
                    let status = response.status().as_u16();

                    if status == 401 && attempt == 0 {
                        if let Some(refresh) = &self.on_unauthorized {
                            // Give the caller one chance to refresh, then try again.
                            if refresh.refresh().await.is_some() && replayable {
                                continue;
                            }
                        }
                    }

                    if response.status().is_success() {
                        return Ok(response);
                    }

                    let status_text = response
                        .status()
                        .canonical_reason()
                        .unwrap_or_default()
                        .to_string();
                    let body = response.text().await.unwrap_or_default();
                    let error = Error::from_response(status, &status_text, &body);

                    if error.is_retryable() && attempt < self.max_retries && replayable {
                        last = Some(error);
                        backoff(attempt).await;
                        continue;
                    }
                    return Err(error);
                }
                Err(error) => {
                    // A network failure is worth retrying; a rejection from the server is not.
                    if !error.is_retryable() || attempt == self.max_retries || !replayable {
                        return Err(error);
                    }
                    last = Some(error);
                    backoff(attempt).await;
                }
            }
        }

        Err(last.unwrap_or_else(|| Error::Oauth("request failed".into())))
    }

    async fn attempt(
        &self,
        method: Method,
        path: &str,
        options: &mut RequestOptions,
    ) -> Result<Response> {
        let url = self.url(path, &options.query)?;
        let mut request = self.client.request(method, url);

        let mut headers = HeaderMap::new();
        for (key, value) in &options.headers {
            if let (Ok(name), Ok(val)) = (
                HeaderName::from_bytes(key.as_bytes()),
                HeaderValue::from_str(value),
            ) {
                headers.insert(name, val);
            }
        }
        if let Some(authorization) = self.authorization().await {
            if let Ok(value) = HeaderValue::from_str(&authorization) {
                headers.insert(AUTHORIZATION, value);
            }
        }

        if let Some(form) = options.form.take() {
            request = request.multipart(form);
        } else if let Some(raw) = &options.raw {
            headers
                .entry(CONTENT_TYPE)
                .or_insert(HeaderValue::from_static("application/octet-stream"));
            request = request.body(raw.clone());
        } else if let Some(json) = &options.json {
            headers
                .entry(CONTENT_TYPE)
                .or_insert(HeaderValue::from_static("application/json"));
            request = request.body(serde_json::to_vec(json)?);
        }

        Ok(request.headers(headers).send().await?)
    }
}

/// The default transport. Falls back to a plain client if the builder refuses, so a
/// timeout setting can never be the reason a client cannot be constructed at all.
pub(crate) fn build_client(connect_timeout: Option<Duration>) -> reqwest::Client {
    let mut builder = reqwest::Client::builder();
    if let Some(timeout) = connect_timeout {
        builder = builder.connect_timeout(timeout);
    }
    builder.build().unwrap_or_default()
}

/// Exponential backoff with full jitter, so a fleet of phones retrying after an outage
/// does not arrive in lockstep.
async fn backoff(attempt: u32) {
    tokio::time::sleep(backoff_delay(attempt)).await;
}

pub(crate) fn backoff_delay(attempt: u32) -> Duration {
    let base = 250u64 * 2u64.pow(attempt);
    let jitter = rand::thread_rng().gen_range(0..base);
    Duration::from_millis(base + jitter)
}
