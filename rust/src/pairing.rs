use std::sync::Arc;

use reqwest::Method;

use crate::error::Result;
use crate::http::{HttpClient, RequestOptions};
use crate::models::*;

/// Handing a device an account without making anybody type a hostname.
///
/// The two halves of this run in different places and are meant to. A browser that is
/// already signed in calls [`Pairing::create`] and renders the ticket as a QR code; a
/// phone that knows nothing at all reads the code out of it and calls [`Pairing::claim`].
/// Between them the device learns where the server is and gets an authorization code for
/// it, in one gesture.
///
/// What [`Pairing::claim`] returns is an ordinary OAuth code bound to a PKCE challenge the
/// device generated, so a photographed QR code is not on its own enough to reach a
/// library.
pub struct Pairing {
    http: Arc<HttpClient>,
}

impl Pairing {
    pub(crate) fn new(http: Arc<HttpClient>) -> Self {
        Self { http }
    }

    /// Makes a ticket. Needs a browser session — a bearer token is refused, because a
    /// paired device that could mint tickets would be a device that could pair others.
    ///
    /// The code is legible only in this response.
    pub async fn create(&self) -> Result<PairingTicket> {
        self.http
            .request(Method::POST, "/api/v1/pairing", RequestOptions::default())
            .await
    }

    /// Whether a device has taken the ticket yet, and what it called itself.
    pub async fn status(&self, ticket_id: &str) -> Result<PairingStatus> {
        self.http
            .request(
                Method::GET,
                &format!("/api/v1/pairing/{ticket_id}"),
                RequestOptions::default(),
            )
            .await
    }

    /// Spends a ticket. Called by the device, not by the browser that made it.
    pub async fn claim(&self, request: &PairingClaimRequest) -> Result<PairingClaim> {
        self.http
            .request(
                Method::POST,
                "/api/v1/pairing/claim",
                RequestOptions::json(request)?,
            )
            .await
    }
}
