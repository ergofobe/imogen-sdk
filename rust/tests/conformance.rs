//! The Rust half of the shared conformance suite.
//!
//! Everything asserted here comes out of `../../conformance`, so this file and its
//! TypeScript, Python, Swift and Kotlin counterparts are checking the same contract
//! rather than four independent opinions about it.

mod stub;

use std::path::Path;
use std::sync::Arc;

use imogen_sdk::*;
use serde_json::Value;

use stub::Reply;

const ENDPOINTS: &str = include_str!("../../conformance/endpoints.json");
const MODELS: &str = include_str!("../../conformance/models.json");
const ERRORS: &str = include_str!("../../conformance/errors.json");

fn fixture(raw: &str) -> Value {
    serde_json::from_str(raw).expect("conformance fixture is valid JSON")
}

/// Walks a dotted path, so a failure names the field rather than dumping the model.
fn at<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for key in path.split('.') {
        current = match current {
            Value::Array(items) => items.get(key.parse::<usize>().ok()?)?,
            _ => current.get(key)?,
        };
    }
    Some(current)
}

// --- the endpoint table ---

/// Performs one operation from the contract. Returns false when the client has no way to
/// perform it, which is itself a conformance failure.
async fn invoke(client: &ImogenClient, key: &str, big_file: &Path) -> bool {
    let ids = ["ASSET".to_string()];
    let query = AssetQuery::default();

    match key {
        "client.health" => drop(client.health().await),

        "assets.list" => drop(client.assets.list(&query).await),
        "assets.get" => drop(client.assets.get("ASSET").await),
        "assets.update" => drop(
            client
                .assets
                .update(
                    "ASSET",
                    &AssetUpdate {
                        favorite: Some(true),
                        ..Default::default()
                    },
                )
                .await,
        ),
        "assets.shareLink" => drop(client.assets.share_link("ASSET").await),
        "assets.share" => drop(
            client
                .assets
                .share("ASSET", &ShareLinkCreate::default())
                .await,
        ),
        "assets.unshare" => drop(client.assets.unshare("ASSET").await),
        "assets.trash" => drop(client.assets.trash(&ids).await),
        "assets.restore" => drop(client.assets.restore(&ids).await),
        "assets.timeline" => drop(client.assets.timeline().await),
        "assets.stats" => drop(client.assets.stats().await),
        "assets.variant" => drop(client.assets.bytes("ASSET", AssetVariant::Thumbnail).await),
        "assets.download" => drop(
            client
                .http
                .send(
                    Method::GET,
                    "/api/v1/assets/ASSET/download",
                    RequestOptions::default(),
                )
                .await,
        ),
        "assets.upload" => {
            let small = std::env::temp_dir().join("imogen-conformance-small.jpg");
            std::fs::write(&small, b"not really a jpeg").unwrap();
            drop(client.assets.upload(&small, &UploadOptions::new()).await)
        }
        "assets.createUploadSession" | "assets.uploadChunk" | "assets.completeUpload" => {
            drop(client.assets.upload(big_file, &UploadOptions::new()).await)
        }

        "albums.list" => drop(client.albums.list().await),
        "albums.get" => drop(client.albums.get("ALBUM").await),
        "albums.create" => drop(
            client
                .albums
                .create(&AlbumCreate {
                    name: "A".into(),
                    ..Default::default()
                })
                .await,
        ),
        "albums.update" => drop(
            client
                .albums
                .update(
                    "ALBUM",
                    &AlbumUpdate {
                        name: Some("B".into()),
                        ..Default::default()
                    },
                )
                .await,
        ),
        "albums.remove" => drop(client.albums.remove("ALBUM").await),
        "albums.addAssets" => drop(client.albums.add_assets("ALBUM", &ids).await),
        "albums.removeAssets" => drop(client.albums.remove_assets("ALBUM", &ids).await),
        "albums.shareLink" => drop(client.albums.share_link("ALBUM").await),
        "albums.share" => drop(
            client
                .albums
                .share("ALBUM", &ShareLinkCreate::default())
                .await,
        ),
        "albums.unshare" => drop(client.albums.unshare("ALBUM").await),

        "people.status" => drop(client.people.status().await),
        "people.setEnabled" => drop(client.people.set_enabled(true).await),
        "people.list" => drop(client.people.list(false).await),
        "people.get" => drop(client.people.get("PERSON").await),
        "people.update" => drop(
            client
                .people
                .update(
                    "PERSON",
                    &PersonUpdate {
                        name: Some(Some("Ada".into())),
                        ..Default::default()
                    },
                )
                .await,
        ),
        "people.merge" => drop(client.people.merge("PERSON", &["OTHER".to_string()]).await),
        "people.reassign" => drop(client.people.reassign(&["FACE".to_string()], None).await),
        "people.facesIn" => drop(client.people.faces_in("ASSET").await),
        "people.thumbnail" => drop(
            client
                .http
                .send(
                    Method::GET,
                    "/api/v1/people/thumbnail/FACE",
                    RequestOptions::default(),
                )
                .await,
        ),

        "vault.status" => drop(client.vault.status().await),
        "vault.setPassphrase" => drop(client.vault.set_passphrase("open sesame").await),
        "vault.unlock" => drop(client.vault.unlock("open sesame").await),
        "vault.lock" => drop(client.vault.lock().await),
        "vault.list" => drop(client.vault.list(200).await),
        "vault.moveIn" => drop(client.vault.move_in(&ids).await),
        "vault.moveOut" => drop(client.vault.move_out(&ids).await),

        "auth.config" => drop(client.auth.config().await),
        "auth.login" => drop(
            client
                .auth
                .login(&LoginRequest {
                    email: "a@b.c".into(),
                    password: "x".into(),
                })
                .await,
        ),
        "auth.signup" => drop(
            client
                .auth
                .signup(&SignupRequest {
                    email: "a@b.c".into(),
                    password: "x".into(),
                    name: "A".into(),
                    invite: None,
                })
                .await,
        ),
        "auth.logout" => drop(client.auth.logout().await),
        "auth.logoutEverywhere" => drop(client.auth.logout_everywhere().await),
        "auth.me" => drop(client.auth.me().await),
        "auth.updateProfile" => drop(
            client
                .auth
                .update_profile(&ProfileUpdate {
                    name: Some("A".into()),
                    ..Default::default()
                })
                .await,
        ),
        "auth.changePassword" => drop(
            client
                .auth
                .change_password(&PasswordChangeRequest {
                    current_password: None,
                    new_password: "xxxxxxxxxx".into(),
                })
                .await,
        ),
        "auth.oidcStart" => drop(
            client
                .http
                .send(
                    Method::GET,
                    "/api/v1/auth/oidc/start",
                    RequestOptions::default(),
                )
                .await,
        ),

        "admin.users" => drop(client.admin.users().await),
        "admin.updateUser" => drop(
            client
                .admin
                .update_user(
                    "USER",
                    &AdminUserUpdate {
                        role: Some(UserRole::User),
                        ..Default::default()
                    },
                )
                .await,
        ),
        "admin.deleteUser" => drop(client.admin.delete_user("USER").await),
        "admin.resetPassword" => drop(client.admin.reset_password("USER", "xxxxxxxxxx").await),
        "admin.invites" => drop(client.admin.invites().await),
        "admin.createInvite" => drop(client.admin.create_invite(&InviteCreate::default()).await),
        "admin.revokeInvite" => drop(client.admin.revoke_invite("INVITE").await),
        "admin.queue" => drop(client.admin.queue().await),
        "admin.retryJob" => drop(client.admin.retry_job("JOB").await),
        "admin.retryAllJobs" => drop(client.admin.retry_all_jobs().await),
        "admin.discardJob" => drop(client.admin.discard_job("JOB").await),
        "admin.clients" => drop(client.admin.clients().await),
        "admin.revokeClient" => drop(client.admin.revoke_client("CLIENT").await),
        "admin.sessions" => drop(client.admin.sessions().await),
        "admin.revokeSession" => drop(client.admin.revoke_session("SESSION").await),
        "admin.storage" => drop(client.admin.storage().await),
        "admin.settings" => drop(client.admin.settings().await),
        "admin.updateSettings" => drop(
            client
                .admin
                .update_settings(&ServerSettingsUpdate {
                    allow_signup: Some(true),
                    ..Default::default()
                })
                .await,
        ),
        "admin.shares" => drop(client.admin.shares().await),
        "admin.revokeShare" => drop(client.admin.revoke_share("SHARE").await),

        "pairing.create" => drop(client.pairing.create().await),
        "pairing.status" => drop(client.pairing.status("TICKET").await),
        "pairing.claim" => drop(
            client
                .pairing
                .claim(&PairingClaimRequest::new(
                    "imog_pair_x",
                    "CLIENT",
                    "imogen://oauth",
                    "x".repeat(43),
                ))
                .await,
        ),

        "oauth.discover" => drop(
            client
                .http
                .send(
                    Method::GET,
                    "/.well-known/oauth-authorization-server",
                    RequestOptions::default(),
                )
                .await,
        ),

        _ => return false,
    }
    true
}

fn concrete(path: &str) -> String {
    path.replace("{assetId}", "ASSET")
        .replace("{albumId}", "ALBUM")
        .replace("{personId}", "PERSON")
        .replace("{faceId}", "FACE")
        .replace("{userId}", "USER")
        .replace("{inviteId}", "INVITE")
        .replace("{jobId}", "JOB")
        .replace("{clientId}", "CLIENT")
        .replace("{sessionId}", "SESSION")
        .replace("{shareId}", "SHARE")
        .replace("{ticketId}", "TICKET")
        .replace("{variant}", "thumbnail")
}

#[tokio::test]
async fn every_operation_in_the_contract_reaches_the_right_endpoint() {
    // The resumable path needs a file over the threshold. A sparse one costs no disk.
    let big_file = std::env::temp_dir().join("imogen-conformance-big.mov");
    let file = std::fs::File::create(&big_file).unwrap();
    file.set_len(RESUMABLE_THRESHOLD_BYTES).unwrap();
    drop(file);

    let server = stub::start(|request, _| {
        if request.path == "/api/v1/uploads" && request.method == "POST" {
            return Reply::json(format!(
                r#"{{"id":"SESSION","offset":0,"sizeBytes":{RESUMABLE_THRESHOLD_BYTES},"expiresAt":"2030-01-01T00:00:00.000Z","existing":null}}"#
            ));
        }
        if request.path.starts_with("/api/v1/uploads/") {
            return Reply::json(format!(r#"{{"offset":{RESUMABLE_THRESHOLD_BYTES}}}"#));
        }
        Reply::json(r#"{"items":[],"nextCursor":null,"total":0}"#)
    })
    .await;

    let table = fixture(ENDPOINTS);
    let resources = table["resources"].as_object().unwrap();

    let mut missing: Vec<String> = Vec::new();
    let mut wrong: Vec<String> = Vec::new();

    for (resource, operations) in resources {
        for endpoint in operations.as_array().unwrap() {
            let operation = endpoint["operation"].as_str().unwrap();
            let method = endpoint["method"].as_str().unwrap();
            let path = concrete(endpoint["path"].as_str().unwrap());
            let key = format!("{resource}.{operation}");

            let client = ImogenClient::new(ClientOptions::new(&server.base_url).max_retries(0));
            let before = server.call_count();

            if !invoke(&client, &key, &big_file).await {
                missing.push(key);
                continue;
            }

            let seen = server.calls();
            let made = &seen[before..];
            let matched = made
                .iter()
                .any(|call| call.method == method && call.path == path);

            if !matched {
                wrong.push(format!(
                    "{key}: wanted {method} {path}, saw {:?}",
                    made.iter()
                        .map(|c| format!("{} {}", c.method, c.path))
                        .collect::<Vec<_>>()
                ));
            }
        }
    }

    assert!(
        missing.is_empty(),
        "the contract names operations the client cannot perform: {missing:#?}"
    );
    assert!(wrong.is_empty(), "{wrong:#?}");
}

// --- models ---

/// Decodes a fixture into `T`, re-encodes it, and checks the asserted fields survived.
/// The round trip is the point: a field the type forgot would decode fine and then
/// vanish on the way back out.
fn check_model<T>(name: &str)
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let models = fixture(MODELS);
    let entry = &models[name];
    let payload = &entry["payload"];

    let decoded: T = serde_json::from_value(payload.clone())
        .unwrap_or_else(|e| panic!("{name} did not decode: {e}"));
    let encoded = serde_json::to_value(&decoded).unwrap();

    for (path, expected) in entry["assert"].as_object().unwrap() {
        let actual = at(&encoded, path).unwrap_or(&Value::Null);
        assert_eq!(
            actual, expected,
            "{name}.{path}: expected {expected}, got {actual}"
        );
    }
}

#[test]
fn models_decode_as_the_contract_says() {
    check_model::<Asset>("asset");
    check_model::<Asset>("assetMinimal");
    check_model::<AssetPage>("assetPage");
    check_model::<Album>("album");
    check_model::<AlbumAssetsResult>("albumAssetsResult");
    check_model::<ShareLink>("shareLink");
    check_model::<User>("user");
    check_model::<AuthConfig>("authConfigOidcOff");
    check_model::<AuthConfig>("authConfigOidcOn");
    check_model::<Person>("person");
    check_model::<Person>("personUnnamed");
    check_model::<DetectedFace>("detectedFace");
    check_model::<FaceStatus>("faceStatus");
    check_model::<VaultStatus>("vaultStatusLocked");
    check_model::<VaultStatus>("vaultStatusUnlocked");
    check_model::<Timeline>("timeline");
    check_model::<LibraryStats>("libraryStats");
    check_model::<UploadSession>("uploadSession");
    check_model::<AdminUser>("adminUser");
    check_model::<QueueHealth>("queueHealth");
    check_model::<StorageReport>("storageReport");
    check_model::<ServerSettings>("serverSettings");
    check_model::<TokenResponse>("tokenResponse");
    check_model::<PairingTicket>("pairingTicket");
    check_model::<PairingStatus>("pairingStatusUnclaimed");
    check_model::<PairingStatus>("pairingStatusClaimed");
    check_model::<PairingClaim>("pairingClaim");
}

// --- errors ---

#[test]
fn errors_are_classified_as_the_contract_says() {
    let errors = fixture(ERRORS);

    for case in errors["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let status = case["status"].as_u64().unwrap() as u16;
        let body = match case.get("bodyRaw") {
            Some(raw) => raw.as_str().unwrap().to_string(),
            None => case["body"].to_string(),
        };
        let want = &case["expect"];

        let error = Error::from_response(status, "", &body);

        assert_eq!(error.status(), Some(status), "{name}: status");
        assert_eq!(error.code(), want["code"].as_str(), "{name}: code");
        assert_eq!(
            error.is_retryable(),
            want["retryable"].as_bool().unwrap(),
            "{name}: retryable"
        );
        assert_eq!(
            error.is_auth_error(),
            want["authError"].as_bool().unwrap(),
            "{name}: authError"
        );

        if let Some(message) = want["message"].as_str() {
            assert_eq!(
                error.to_string(),
                format!("{message} ({status} {})", want["code"].as_str().unwrap()),
                "{name}: message"
            );
        }

        match want["details"].as_object() {
            Some(expected) => {
                let details = error.details().expect("expected field detail");
                for (field, messages) in expected {
                    let got = details.get(field).expect("expected detail for field");
                    let wanted: Vec<String> = messages
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|m| m.as_str().unwrap().to_string())
                        .collect();
                    assert_eq!(got, &wanted, "{name}: details.{field}");
                }
            }
            None => assert!(error.details().is_none(), "{name}: expected no detail"),
        }
    }
}

#[test]
fn tuning_constants_match_the_contract() {
    let errors = fixture(ERRORS);
    let upload = &errors["upload"];

    assert_eq!(
        BULK_UPLOAD_CONCURRENCY as u64,
        upload["bulkConcurrency"].as_u64().unwrap()
    );
    assert_eq!(
        RESUMABLE_THRESHOLD_BYTES,
        upload["resumableThresholdBytes"].as_u64().unwrap()
    );
    assert_eq!(UPLOAD_CHUNK_BYTES, upload["chunkBytes"].as_u64().unwrap());
}

// --- transport ---

#[tokio::test]
async fn retries_a_retryable_rejection_and_then_succeeds() {
    let server = stub::start(|_, index| {
        if index < 2 {
            Reply::status(429, r#"{"error":{"code":"rate_limited","message":"slow"}}"#)
        } else {
            Reply::json(r#"{"status":"ok","version":"0.1.0"}"#)
        }
    })
    .await;

    let client = ImogenClient::new(ClientOptions::new(&server.base_url));
    let health = client.health().await.expect("should have succeeded");

    assert_eq!(health.status, "ok");
    assert_eq!(server.call_count(), 3);
}

#[tokio::test]
async fn does_not_retry_a_rejection_the_server_will_keep_rejecting() {
    let server =
        stub::start(|_, _| Reply::status(404, r#"{"error":{"code":"not_found","message":"no"}}"#))
            .await;

    let client = ImogenClient::new(ClientOptions::new(&server.base_url));
    let error = client.assets.get("nope").await.unwrap_err();

    assert_eq!(error.status(), Some(404));
    assert_eq!(server.call_count(), 1);
}

struct Refresh;

impl RefreshToken for Refresh {
    fn refresh(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async { Some("fresh".to_string()) })
    }
}

#[tokio::test]
async fn sends_the_bearer_token() {
    let server =
        stub::start(|_, _| Reply::json(r#"{"items":[],"nextCursor":null,"total":0}"#)).await;

    let client = ImogenClient::new(ClientOptions::new(&server.base_url).token("abc123"));
    client.assets.list(&AssetQuery::default()).await.unwrap();

    let calls = server.calls();
    assert_eq!(
        calls[0].headers.get("authorization").map(String::as_str),
        Some("Bearer abc123")
    );
}

#[tokio::test]
async fn asks_for_a_fresh_token_once_when_the_server_rejects_the_old_one() {
    let server = stub::start(|_, index| {
        if index == 0 {
            Reply::status(401, r#"{"error":{"code":"unauthorized","message":"x"}}"#)
        } else {
            Reply::json(r#"{"items":[],"nextCursor":null,"total":0}"#)
        }
    })
    .await;

    let client = ImogenClient::new(
        ClientOptions::new(&server.base_url)
            .token("stale")
            .on_unauthorized(Arc::new(Refresh)),
    );

    client.assets.list(&AssetQuery::default()).await.unwrap();
    assert_eq!(server.call_count(), 2);
}

#[tokio::test]
async fn builds_image_urls_without_a_request() {
    let client = ImogenClient::new(ClientOptions::new("https://photos.example.test/"));

    assert_eq!(
        client.assets.url_for("A1", AssetVariant::Thumbnail),
        "https://photos.example.test/api/v1/assets/A1/thumbnail"
    );
    assert_eq!(
        client.assets.url_for("A1", AssetVariant::Preview),
        "https://photos.example.test/api/v1/assets/A1/preview"
    );
    assert_eq!(
        client.assets.download_url("A1"),
        "https://photos.example.test/api/v1/assets/A1/download"
    );
}

#[tokio::test]
async fn walks_every_page_exactly_once() {
    let server = stub::start(|_, index| {
        if index == 0 {
            Reply::json(
                r#"{"items":[{"id":"a","ownerId":"o","type":"image","status":"ready","originalFilename":"a.jpg","mimeType":"image/jpeg","checksum":"c","sizeBytes":1,"width":null,"height":null,"duration":null,"capturedAt":"2024-01-01T00:00:00.000Z","capturedAtIsExact":true,"capturedAtOriginal":null,"capturedAtOriginalIsExact":null,"createdAt":"2024-01-01T00:00:00.000Z","updatedAt":"2024-01-01T00:00:00.000Z","deletedAt":null,"favorite":false,"archived":false,"description":null,"exif":null,"location":null,"placeholderColor":null,"livePhotoVideoId":null,"deviceAssetId":null}],"nextCursor":"c1","total":2}"#,
            )
        } else {
            Reply::json(
                r#"{"items":[{"id":"b","ownerId":"o","type":"image","status":"ready","originalFilename":"b.jpg","mimeType":"image/jpeg","checksum":"c","sizeBytes":1,"width":null,"height":null,"duration":null,"capturedAt":"2024-01-01T00:00:00.000Z","capturedAtIsExact":true,"capturedAtOriginal":null,"capturedAtOriginalIsExact":null,"createdAt":"2024-01-01T00:00:00.000Z","updatedAt":"2024-01-01T00:00:00.000Z","deletedAt":null,"favorite":false,"archived":false,"description":null,"exif":null,"location":null,"placeholderColor":null,"livePhotoVideoId":null,"deviceAssetId":null}],"nextCursor":null,"total":2}"#,
            )
        }
    })
    .await;

    let client = ImogenClient::new(ClientOptions::new(&server.base_url));
    let all = client
        .assets
        .list_all(&AssetQuery::default())
        .await
        .unwrap();

    let ids: Vec<&str> = all.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(ids, vec!["a", "b"]);
}
