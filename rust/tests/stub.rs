//! A stub imogen, small enough to keep in one file.
//!
//! The conformance suite needs a server that records what it was asked and answers
//! predictably. Pulling in an HTTP server framework to get that would mean the tests
//! depend on more than the crate does, so this speaks just enough HTTP/1.1.

#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub struct Reply {
    pub status: u16,
    pub body: String,
}

impl Reply {
    pub fn json(body: impl Into<String>) -> Reply {
        Reply {
            status: 200,
            body: body.into(),
        }
    }

    pub fn status(status: u16, body: impl Into<String>) -> Reply {
        Reply {
            status,
            body: body.into(),
        }
    }
}

pub struct Stub {
    pub base_url: String,
    calls: Arc<Mutex<Vec<Recorded>>>,
}

impl Stub {
    pub fn calls(&self) -> Vec<Recorded> {
        self.calls.lock().unwrap().clone()
    }

    pub fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

/// Starts a stub on an ephemeral port and returns once it is accepting.
pub async fn start<F>(responder: F) -> Stub
where
    F: Fn(&Recorded, usize) -> Reply + Send + Sync + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let calls: Arc<Mutex<Vec<Recorded>>> = Arc::new(Mutex::new(Vec::new()));

    let recorded = calls.clone();
    let responder = Arc::new(responder);

    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let recorded = recorded.clone();
            let responder = responder.clone();

            tokio::spawn(async move {
                let Some(request) = read_request(&mut socket).await else {
                    return;
                };

                let index = {
                    let mut calls = recorded.lock().unwrap();
                    calls.push(request.clone());
                    calls.len() - 1
                };

                let reply = responder(&request, index);
                let response = format!(
                    "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    reply.status,
                    reason(reply.status),
                    reply.body.len(),
                    reply.body,
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.flush().await;
            });
        }
    });

    Stub {
        base_url: format!("http://{addr}"),
        calls,
    }
}

async fn read_request(socket: &mut tokio::net::TcpStream) -> Option<Recorded> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];

    // Read until the blank line that ends the headers.
    let header_end = loop {
        let read = socket.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = find(&buffer, b"\r\n\r\n") {
            break position;
        }
    };

    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target.clone(), String::new()),
    };

    // Then read exactly as many body bytes as the sender promised.
    let mut body = buffer[header_end + 4..].to_vec();
    let expected: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    while body.len() < expected {
        let read = socket.read(&mut chunk).await.ok()?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }

    Some(Recorded {
        method,
        path,
        query,
        headers,
        body,
    })
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        422 => "Unprocessable Entity",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "",
    }
}
