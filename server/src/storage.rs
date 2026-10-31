//! Media on Backblaze B2 (S3 API) served through cdn.kreatix.dev (Cloudflare, no egress).
//! Deleting a file also purges that single URL from Cloudflare's cache.

use aes_gcm::{
    aead::{Aead, OsRng, rand_core::RngCore},
    Aes256Gcm, KeyInit, Nonce,
};
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
    encryption_key: Option<[u8; 32]>,
}

static STORE: OnceLock<Option<Storage>> = OnceLock::new();

pub fn get() -> Option<&'static Storage> {
    STORE
        .get_or_init(|| {
            let v = |k: &str| std::env::var(k).ok().filter(|s| !s.is_empty());
            let encryption_key = match v("YAP_MEDIA_KEY") {
                Some(raw) if raw.len() == 64 && raw.bytes().all(|b| b.is_ascii_hexdigit()) => {
                    let bytes = hex::decode(raw).ok()?;
                    let mut key = [0; 32];
                    key.copy_from_slice(&bytes);
                    Some(key)
                }
                Some(_) => {
                    tracing::warn!("YAP_MEDIA_KEY is invalid; media encryption is disabled");
                    None
                }
                None => {
                    tracing::warn!("YAP_MEDIA_KEY is unset; media encryption is disabled");
                    None
                }
            };
            Some(Storage {
                http: reqwest::Client::builder().timeout(Duration::from_secs(30)).build().ok()?,
                key_id: v("YAP_STORAGE_KEY_ID")?,
                secret: v("YAP_STORAGE_KEY")?,
                bucket: v("YAP_STORAGE_BUCKET").unwrap_or_else(|| "Yapp-Data".into()),
                cf: v("YAP_CF_TOKEN").zip(v("YAP_CF_ZONE")),
                encryption_key,
            })
        })
        .as_ref()
}

fn hmac(k: &[u8], m: &str) -> Vec<u8> {
    let mut h = <Hmac<Sha256> as Mac>::new_from_slice(k).expect("hmac key");
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
        if self.encryption_key.is_some() {
            format!("https://yap.kreatix.dev/m/{key}")
        } else {
            format!("{CDN}/{}/{key}", self.bucket)
        }
    }

    pub fn encryption_enabled(&self) -> bool {
        self.encryption_key.is_some()
    }

    fn encrypt(&self, body: &[u8]) -> Result<Vec<u8>, String> {
        let key = self.encryption_key.as_ref().ok_or_else(|| "media encryption is disabled".to_string())?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
        let mut nonce = [0; 12];
        OsRng.fill_bytes(&mut nonce);
        let ciphertext = cipher.encrypt(Nonce::from_slice(&nonce), body).map_err(|e| e.to_string())?;
        let mut blob = nonce.to_vec();
        blob.extend_from_slice(&ciphertext);
        Ok(blob)
    }

    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, String> {
        if blob.len() < 12 {
            return Err("encrypted media is truncated".into());
        }
        let key = self.encryption_key.as_ref().ok_or_else(|| "media encryption key is unavailable".to_string())?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
        cipher.decrypt(Nonce::from_slice(&blob[..12]), &blob[12..]).map_err(|e| e.to_string())
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
        let (object_key, body, content_type) = if self.encryption_key.is_some() {
            (format!("enc/{key}"), self.encrypt(&body)?, "application/octet-stream")
        } else {
            (key.to_string(), body, ctype)
        };
        let r = self
            .signed(reqwest::Method::PUT, &object_key, body)
            .header("content-type", content_type)
            .header("cache-control", "public, max-age=31536000, immutable")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if r.status().is_success() { Ok(()) } else { Err(format!("{}: {}", r.status(), r.text().await.unwrap_or_default().chars().take(200).collect::<String>())) }
    }

    async fn delete_object(&self, key: &str) {
        match self.signed(reqwest::Method::DELETE, key, Vec::new()).send().await {
            Ok(r) if r.status().is_success() || r.status().as_u16() == 404 => {}
            Ok(r) => tracing::warn!(key, status = %r.status(), "b2 delete"),
            Err(e) => tracing::warn!(key, error = %e, "b2 delete"),
        }
    }

    async fn purge_urls(&self, urls: Vec<String>, key: &str) -> Result<(), String> {
        if let Some((token, zone)) = &self.cf {
            let response = self
                .http
                .post(format!("https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache"))
                .bearer_auth(token)
                .json(&serde_json::json!({ "files": urls }))
                .send()
                .await
                .map_err(|error| format!("cdn purge for {key}: {error}"))?;
            if !response.status().is_success() {
                return Err(format!("cdn purge for {key} returned {}", response.status()));
            }
        }
        Ok(())
    }

    /// Delete both object formats and purge their CDN copies. Best effort.
    pub async fn delete(&self, key: &str) {
        self.delete_object(&format!("enc/{key}")).await;
        self.delete_object(key).await;
        if let Err(error) = self.purge_urls(
            vec![format!("{CDN}/{}/enc/{key}", self.bucket), format!("{CDN}/{}/{key}", self.bucket)],
            key,
        )
        .await {
            tracing::warn!(key, error = %error, "cdn purge");
        }
    }

    pub async fn delete_plain(&self, key: &str) {
        self.delete_object(key).await;
        if let Err(error) = self.purge_urls(vec![format!("{CDN}/{}/{key}", self.bucket)], key).await {
            tracing::warn!(key, error = %error, "cdn purge");
        }
    }

    pub async fn purge_encrypted(&self, key: &str) -> Result<(), String> {
        if self.cf.is_none() {
            return Err("Cloudflare purge is not configured".into());
        }
        self.purge_urls(vec![format!("{CDN}/{}/enc/{key}", self.bucket)], key).await
    }

    async fn get_cdn(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        let response = self.http.get(format!("{CDN}/{}/{key}", self.bucket)).send().await.map_err(|e| e.to_string())?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(format!("cdn {} for {key}", response.status()));
        }
        response.bytes().await.map(|b| Some(b.to_vec())).map_err(|e| e.to_string())
    }

    pub async fn encrypted_exists(&self, key: &str) -> Result<bool, String> {
        let response = self
            .signed(reqwest::Method::HEAD, &format!("enc/{key}"), Vec::new())
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if response.status().is_success() {
            Ok(true)
        } else if response.status() == reqwest::StatusCode::NOT_FOUND {
            Ok(false)
        } else {
            Err(format!("b2 {} for enc/{key}", response.status()))
        }
    }

    pub async fn get_plain(&self, key: &str) -> Result<Option<(Vec<u8>, &'static str)>, String> {
        if !valid_media_key(key) {
            return Err("invalid media key".into());
        }
        let (_, ext) = key.rsplit_once('.').ok_or_else(|| "invalid media key".to_string())?;
        let ctype = match ext {
            "jpg" => "image/jpeg",
            "webp" => "image/webp",
            "png" => "image/png",
            _ => return Err("invalid media key".into()),
        };
        if let Some(blob) = self.get_cdn(&format!("enc/{key}")).await? {
            return self.decrypt(&blob).map(|bytes| Some((bytes, ctype)));
        }
        self.get_cdn(key).await.map(|bytes| bytes.map(|bytes| (bytes, ctype)))
    }
}

pub fn valid_media_key(key: &str) -> bool {
    let Some((prefix, rest)) = key.split_once('-') else { return false };
    if !matches!(prefix, "p" | "q" | "b" | "c" | "s") {
        return false;
    }
    let Some((hash, ext)) = rest.rsplit_once('.') else { return false };
    hash.len() == 32
        && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && matches!(ext, "jpg" | "webp" | "png")
}

/// Image sniffing: returns (extension, content type) for JPEG, WebP, or PNG.
pub fn image_kind(b: &[u8]) -> Option<(&'static str, &'static str)> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("jpg", "image/jpeg"))
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else {
        None
    }
}

/// Content-addressed key, so identical uploads are stored once.
pub fn key_for(prefix: &str, b: &[u8], ext: &str) -> String {
    format!("{prefix}-{}.{ext}", &sha_hex(b)[..32])
}
