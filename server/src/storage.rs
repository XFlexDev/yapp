//! Media on Backblaze B2 (S3 API) served through cdn.kreatix.dev (Cloudflare, no egress).
//! Deleting a file also purges that single URL from Cloudflare's cache.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::{sync::OnceLock, time::Duration};

const HOST: &str = "s3.eu-central-003.backblazeb2.com";
const REGION: &str = "eu-central-003";
const CDN: &str = "https://cdn.kreatix.dev/file";

pub struct Storage {
    http: reqwest::Client,
    key_id: String,
    secret: String,
    bucket: String,
    cf: Option<(String, String)>,
}

static STORE: OnceLock<Option<Storage>> = OnceLock::new();

pub fn get() -> Option<&'static Storage> {
    STORE
        .get_or_init(|| {
            let v = |k: &str| std::env::var(k).ok().filter(|s| !s.is_empty());
            Some(Storage {
                http: reqwest::Client::builder().timeout(Duration::from_secs(30)).build().ok()?,
                key_id: v("YAP_STORAGE_KEY_ID")?,
                secret: v("YAP_STORAGE_KEY")?,
                bucket: v("YAP_STORAGE_BUCKET").unwrap_or_else(|| "Yapp-Data".into()),
                cf: v("YAP_CF_TOKEN").zip(v("YAP_CF_ZONE")),
            })
        })
        .as_ref()
}

fn hmac(k: &[u8], m: &str) -> Vec<u8> {
    let mut h = Hmac::<Sha256>::new_from_slice(k).expect("hmac key");
    h.update(m.as_bytes());
    h.finalize().into_bytes().to_vec()
}

fn sha_hex(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

/// (YYYYMMDD, YYYYMMDDTHHMMSSZ) in UTC without pulling in a date crate.
fn stamp() -> (String, String) {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    let date = format!("{y:04}{m:02}{d:02}");
    (date.clone(), format!("{date}T{:02}{:02}{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60))
}

impl Storage {
    pub fn url(&self, key: &str) -> String {
        format!("{CDN}/{}/{key}", self.bucket)
    }

    fn signed(&self, method: reqwest::Method, key: &str, body: Vec<u8>) -> reqwest::RequestBuilder {
        let (date, amz) = stamp();
        let path = format!("/{}/{key}", self.bucket);
        let payload = sha_hex(&body);
        let canonical = format!("{method}\n{path}\n\nhost:{HOST}\nx-amz-content-sha256:{payload}\nx-amz-date:{amz}\n\nhost;x-amz-content-sha256;x-amz-date\n{payload}");
        let scope = format!("{date}/{REGION}/s3/aws4_request");
        let to_sign = format!("AWS4-HMAC-SHA256\n{amz}\n{scope}\n{}", sha_hex(canonical.as_bytes()));
        let k = hmac(&hmac(&hmac(&hmac(format!("AWS4{}", self.secret).as_bytes(), &date), REGION), "s3"), "aws4_request");
        let sig = hex::encode(hmac(&k, &to_sign));
        self.http
            .request(method, format!("https://{HOST}{path}"))
            .header("x-amz-date", amz)
            .header("x-amz-content-sha256", payload)
            .header("authorization", format!("AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature={sig}", self.key_id))
            .body(body)
    }

    pub async fn put(&self, key: &str, body: Vec<u8>, ctype: &str) -> Result<(), String> {
        let r = self
            .signed(reqwest::Method::PUT, key, body)
            .header("content-type", ctype)
            .header("cache-control", "public, max-age=31536000, immutable")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if r.status().is_success() { Ok(()) } else { Err(format!("{}: {}", r.status(), r.text().await.unwrap_or_default().chars().take(200).collect::<String>())) }
    }

    /// Delete from B2 and purge the CDN copy. Best effort; logs failures.
    pub async fn delete(&self, key: &str) {
        match self.signed(reqwest::Method::DELETE, key, Vec::new()).send().await {
            Ok(r) if r.status().is_success() || r.status().as_u16() == 404 => {}
            Ok(r) => tracing::warn!(key, status = %r.status(), "b2 delete"),
            Err(e) => tracing::warn!(key, error = %e, "b2 delete"),
        }
        if let Some((token, zone)) = &self.cf {
            let r = self
                .http
                .post(format!("https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache"))
                .bearer_auth(token)
                .json(&serde_json::json!({ "files": [self.url(key)] }))
                .send()
                .await;
            if let Err(e) = r {
                tracing::warn!(key, error = %e, "cdn purge");
            }
        }
    }
}

/// Image sniffing: returns (extension, content type) for JPEG or WebP.
pub fn image_kind(b: &[u8]) -> Option<(&'static str, &'static str)> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("jpg", "image/jpeg"))
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else {
        None
    }
}

/// Content-addressed key, so identical uploads are stored once.
pub fn key_for(prefix: &str, b: &[u8], ext: &str) -> String {
    format!("{prefix}-{}.{ext}", &sha_hex(b)[..32])
}
