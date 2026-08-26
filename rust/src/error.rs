use std::collections::BTreeMap;

use crate::models::ApiError;

/// Every failure from the API arrives as one of these, so a caller writes one match arm
/// rather than inspecting status codes at each call site.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The server answered, and said no.
    #[error("{message} ({status} {code})")]
    Api {
        status: u16,
        code: String,
        message: String,
        details: Option<BTreeMap<String, Vec<String>>>,
    },

    /// The request never got an answer.
    #[error("transport: {0}")]
    Transport(#[from] reqwest::Error),

    /// The answer was not the shape the contract promised.
    #[error("could not decode the response: {0}")]
    Decode(#[from] serde_json::Error),

    #[error("invalid URL: {0}")]
    Url(#[from] url::ParseError),

    #[error("{0}")]
    Oauth(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// True when re-sending the same request might succeed.
    pub fn is_retryable(&self) -> bool {
        match self {
            Error::Api { status, .. } => *status == 429 || *status >= 500,
            // A connection that failed to establish or timed out is worth another go.
            Error::Transport(e) => e.is_timeout() || e.is_connect() || e.is_request(),
            _ => false,
        }
    }

    pub fn is_auth_error(&self) -> bool {
        matches!(self, Error::Api { status, .. } if *status == 401 || *status == 403)
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            Error::Api { status, .. } => Some(*status),
            _ => None,
        }
    }

    pub fn code(&self) -> Option<&str> {
        match self {
            Error::Api { code, .. } => Some(code),
            _ => None,
        }
    }

    pub fn details(&self) -> Option<&BTreeMap<String, Vec<String>>> {
        match self {
            Error::Api { details, .. } => details.as_ref(),
            _ => None,
        }
    }

    /// Builds the typed error from a rejection. A body that is not the envelope still
    /// yields an `Api` error, because callers should never have to handle two shapes.
    pub fn from_response(status: u16, status_text: &str, body: &str) -> Error {
        if let Ok(parsed) = serde_json::from_str::<ApiError>(body) {
            return Error::Api {
                status,
                code: parsed.error.code,
                message: parsed.error.message,
                details: parsed.error.details,
            };
        }
        Error::Api {
            status,
            code: "http_error".to_string(),
            message: format!("{status} {status_text}").trim().to_string(),
            details: None,
        }
    }
}
