use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::{Rng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

pub struct Config {
    pub bind: String,
    pub db_path: String,
    pub jwt_secret: String,
    pub lk_key: String,
    pub lk_secret: String,
    pub lk_url: String,
    pub mail_api_url: String,
    pub mail_api_key: Option<String>,
    pub min_build: i64,
    pub avatar_dir: String,
    pub rec_url: String,
    pub fb_project: String,
    pub fb_api_key: Option<String>,
    pub fb_app_id: Option<String>,
    pub rec_secret: Option<String>,
    review: Vec<(String, String)>,
}

impl Config {
    pub fn from_env() -> Self {
        let v = |k: &str| std::env::var(k).ok().filter(|s| !s.is_empty());
        let req = |k: &str| v(k).unwrap_or_else(|| panic!("{k} is required"));
        let jwt_secret = req("YAP_JWT_SECRET");
        assert!(jwt_secret.len() >= 32, "YAP_JWT_SECRET must be at least 32 chars");
        Self {
            bind: v("YAP_BIND").unwrap_or_else(|| "127.0.0.1:8498".into()),
            db_path: v("YAP_DB").unwrap_or_else(|| "yap.sqlite3".into()),
            jwt_secret,
            lk_key: req("LIVEKIT_API_KEY"),
            lk_secret: req("LIVEKIT_API_SECRET"),
            lk_url: req("LIVEKIT_URL"),
            mail_api_url: v("MAIL_API_URL").unwrap_or_else(|| "https://mail.kreatix.dev/send".into()),
            mail_api_key: v("MAIL_API_KEY"),
            avatar_dir: v("YAP_AVATAR_DIR").unwrap_or_else(|| "avatars".into()),
            fb_project: v("YAP_FIREBASE_PROJECT").unwrap_or_else(|| "yapp-kreatix".into()),
            fb_api_key: v("YAP_FIREBASE_API_KEY"),
            fb_app_id: v("YAP_FIREBASE_APP_ID"),
            rec_url: v("YAP_RECORDER_URL").unwrap_or_else(|| "http://127.0.0.1:8499".into()),
            rec_secret: v("YAP_RECORDER_SECRET"),
            min_build: v("YAP_MIN_BUILD").and_then(|s| s.parse().ok()).unwrap_or(1),
            review: v("YAP_REVIEW_CODES")
                .map(|s| {
                    s.split(',')
                        .filter_map(|p| p.split_once(':'))
                        .map(|(e, c)| (e.trim().to_lowercase(), c.trim().to_string()))
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    pub fn review_code(&self, email: &str) -> Option<&str> {
        self.review.iter().find(|(e, _)| e == email).map(|(_, c)| c.as_str())
    }
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn sha256(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

pub fn random_token() -> String {
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    hex::encode(b)
}

pub fn random_code() -> String {
    format!("{:06}", rand::thread_rng().gen_range(0..1_000_000))
}

pub fn random_color() -> i64 {
    rand::thread_rng().gen_range(0..8)
}

pub fn normalize_email(s: &str) -> Option<String> {
    let e = s.trim().to_lowercase();
    let (local, domain) = e.split_once('@')?;
    let ok = !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && e.len() <= 254
        && !e.chars().any(|c| c.is_whitespace() || c == ',' || c == ';' || c == '<' || c == '>');
    ok.then_some(e)
}

pub fn valid_username(u: &str) -> bool {
    (3..=20).contains(&u.len())
        && u.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
        && !u.starts_with('.')
        && !u.ends_with('.')
}

#[derive(Serialize, Deserialize)]
struct AccessClaims {
    sub: String,
    iat: i64,
    exp: i64,
    typ: String,
}

pub const ACCESS_TTL: i64 = 3600;
pub const REFRESH_TTL: i64 = 60 * 24 * 3600;

impl crate::AppState {
    pub fn code_hash(&self, email: &str, code: &str) -> String {
        sha256(&format!("{}:{}:{}", self.cfg.jwt_secret, email, code))
    }

    pub fn access_token(&self, uid: &str) -> String {
        let n = now();
        let c = AccessClaims { sub: uid.into(), iat: n, exp: n + ACCESS_TTL, typ: "access".into() };
        encode(&Header::default(), &c, &EncodingKey::from_secret(self.cfg.jwt_secret.as_bytes()))
            .expect("sign access token")
    }

    pub fn verify_access(&self, t: &str) -> Option<String> {
        let d = decode::<AccessClaims>(
            t,
            &DecodingKey::from_secret(self.cfg.jwt_secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
        .ok()?;
        (d.claims.typ == "access").then_some(d.claims.sub)
    }

    /// LiveKit access token (HS256 JWT with a `video` grant).
    pub fn lk_token(&self, identity: &str, name: &str, room: &str, publish: bool, ttl: i64) -> String {
        let n = now();
        let claims = json!({
            "iss": self.cfg.lk_key,
            "sub": identity,
            "nbf": n - 10,
            "exp": n + ttl,
            "name": name,
            "video": {
                "room": room,
                "roomJoin": true,
                "canPublish": publish,
                "canSubscribe": !publish,
                "canPublishData": false,
                "canPublishSources": if publish { json!(["microphone", "camera"]) } else { json!([]) },
            }
        });
        encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(self.cfg.lk_secret.as_bytes()))
            .expect("sign livekit token")
    }
}
