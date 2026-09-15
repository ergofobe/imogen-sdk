//! What the upload actually puts on the wire.
//!
//! Nothing in the conformance suite can catch an encoding defect here: it compares
//! fixtures between the five ports, and a `Content-Disposition` no fixture describes is
//! invisible to it. Only a test that reads the rendered bytes sees this class of bug, so
//! each port that builds a multipart body carries one. Kotlin's is `UploadMultipartTest`.

mod stub;

use imogen_sdk::{AssetUploadMetadata, ClientOptions, ImogenClient, UploadOptions};
use stub::Reply;

/// The parts' headers, read the way a parser reads them: each part up to its blank line,
/// and no further. Searching the whole body instead would let a part *body* that happens
/// to contain a CRLF and a header-shaped line — which is exactly what a hostile filename
/// puts there — pass for a header.
fn dispositions(body: &[u8]) -> Vec<String> {
    // Byte-for-char rather than UTF-8: the file's own bytes are in here too, and a lossy
    // decode would replace them and shift everything after.
    let text: String = body.iter().map(|b| *b as char).collect();
    let boundary = format!("{}\r\n", text.split("\r\n").next().unwrap_or_default());

    text.split(&boundary)
        .skip(1)
        .flat_map(|part| {
            part.split("\r\n\r\n")
                .next()
                .unwrap_or_default()
                .split("\r\n")
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|line| line.starts_with("Content-Disposition:"))
        .collect()
}

/// `on_disk` names the temporary file, because cargo runs the tests in one binary
/// concurrently and a shared path is one test truncating the file another is reading.
async fn upload_and_capture(on_disk: &str, filename: &str) -> Vec<u8> {
    let path = std::env::temp_dir().join(on_disk);
    std::fs::write(&path, b"not really a jpeg").unwrap();

    let server = stub::start(|_, _| Reply::json("{}")).await;
    let client = ImogenClient::new(ClientOptions::new(&server.base_url).max_retries(0));
    let options = UploadOptions::new().metadata(AssetUploadMetadata {
        filename: Some(filename.to_string()),
        ..Default::default()
    });
    // What comes back does not matter: the stub records the request before it answers,
    // and building a whole valid asset would tie this to a model it is not about.
    drop(client.assets.upload(&path, &options).await);

    server
        .calls()
        .first()
        .expect("no request was made")
        .body
        .clone()
}

#[tokio::test]
async fn the_file_part_carries_an_ordinary_filename_unchanged() {
    let lines = dispositions(&upload_and_capture("imogen-upload-ordinary.jpg", "PXL_1.jpg").await);

    assert!(
        lines
            .iter()
            .any(|line| line.contains("name=\"file\"") && line.contains("filename=\"PXL_1.jpg\"")),
        "the file part must carry its filename: {lines:#?}"
    );
}

/// The name is user data — on a phone it is whatever the photograph is called in the
/// library — and reqwest backslash-escapes it, which is the one encoding undici rejects
/// outright. The WHATWG percent-escapes are what every other port emits.
#[tokio::test]
async fn a_quote_or_a_newline_in_the_filename_is_escaped_not_left_in_the_header() {
    let hostile = "he said \"hi\"\r\nContent-Disposition: form-data; name=\"evil\", ok.jpg";
    let body = upload_and_capture("imogen-upload-hostile.jpg", hostile).await;
    let lines = dispositions(&body);

    let file_part: Vec<&String> = lines
        .iter()
        .filter(|line| line.contains("; name=\"file\""))
        .collect();

    assert_eq!(
        file_part,
        vec![
            &"Content-Disposition: form-data; name=\"file\"; filename=\"he said %22hi%22%0D%0A\
              Content-Disposition: form-data; name=%22evil%22, ok.jpg\""
                .to_string()
        ],
        "the filename must be escaped into the header, not laid into it: {lines:#?}"
    );

    // The escaping is the only thing standing between a display name and an extra part.
    // Two is the whole body here: the file, and the `filename` part beside it.
    assert_eq!(
        lines.len(),
        2,
        "the filename smuggled a part past the encoding: {lines:#?}"
    );
}
