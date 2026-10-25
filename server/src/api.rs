use crate::{db, util::*, AppState};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, FromRequestParts, Path, Query, State,
    },
    http::{header, request::Parts, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;

type S = Arc<AppState>;

pub struct ApiError(StatusCode, &'static str, String);
type R<T> = Result<T, ApiError>;

fn err(s: StatusCode, code: &'static str, m: impl Into<String>) -> ApiError {
    ApiError(s, code, m.into())
}
fn bad(m: impl Into<String>) -> ApiError {
    err(StatusCode::BAD_REQUEST, "InvalidRequest", m)
}
fn unauthorized() -> ApiError {
    err(StatusCode::UNAUTHORIZED, "Unauthorized", "Sign in again")
}
fn not_found(m: impl Into<String>) -> ApiError {
    err(StatusCode::NOT_FOUND, "NotFound", m)
}
fn too_many(m: impl Into<String>) -> ApiError {
    err(StatusCode::TOO_MANY_REQUESTS, "TooManyRequests", m)
}
fn not_friends() -> ApiError {
    err(StatusCode::FORBIDDEN, "Forbidden", "You're not friends")
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        tracing::error!(error = %e, "database");
        err(StatusCode::INTERNAL_SERVER_ERROR, "InternalServerError", "Something went wrong")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1, "message": self.2 }))).into_response()
    }
}

pub struct Authed(String);

impl FromRequestParts<S> for Authed {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, st: &S) -> R<Self> {
        let t = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(unauthorized)?;
        let uid = st.verify_access(t).ok_or_else(unauthorized)?;
        st.db()
            .query_row("SELECT 1 FROM users WHERE id=?", [&uid], |_| Ok(()))
            .optional()?
            .ok_or_else(unauthorized)?;
        Ok(Authed(uid))
    }
}

#[derive(Serialize, Clone)]
struct PublicUser {
    id: String,
    username: Option<String>,
    display_name: String,
    color: i64,
    avatar: Option<String>,
    pfp: Option<String>,
}

#[derive(Serialize)]
struct Me {
    id: String,
    email: String,
    username: Option<String>,
    display_name: String,
    color: i64,
    avatar: Option<String>,
    pfp: Option<String>,
    dnd: bool,
}

#[derive(Serialize)]
struct Friend {
    #[serde(flatten)]
    user: PublicUser,
    online: bool,
    dnd: bool,
    since: i64,
    streak: i64,
    last_talked_at: i64,
}

const USER_COLS: &str = "u.id, u.username, u.display_name, u.color, u.avatar, u.pfp";

fn row_user(r: &Row, o: usize) -> rusqlite::Result<PublicUser> {
    Ok(PublicUser { id: r.get(o)?, username: r.get(o + 1)?, display_name: r.get(o + 2)?, color: r.get(o + 3)?, avatar: r.get(o + 4)?, pfp: r.get(o + 5)? })
}

fn public_user(c: &Connection, id: &str) -> R<PublicUser> {
    c.query_row(&format!("SELECT {USER_COLS} FROM users u WHERE u.id=?"), [id], |r| row_user(r, 0))
        .optional()?
        .ok_or_else(|| not_found("User not found"))
}

fn me_of(c: &Connection, id: &str) -> R<Me> {
    c.query_row(
        "SELECT id, email, username, display_name, color, dnd, avatar, pfp FROM users WHERE id=?",
        [id],
        |r| {
            Ok(Me {
                id: r.get(0)?,
                email: r.get(1)?,
                username: r.get(2)?,
                display_name: r.get(3)?,
                color: r.get(4)?,
                dnd: r.get::<_, i64>(5)? != 0,
                avatar: r.get(6)?,
                pfp: r.get(7)?,
            })
        },
    )
    .optional()?
    .ok_or_else(unauthorized)
}

fn friend_ids(c: &Connection, uid: &str) -> rusqlite::Result<Vec<String>> {
    let mut s = c.prepare("SELECT CASE WHEN a=?1 THEN b ELSE a END FROM friendships WHERE a=?1 OR b=?1")?;
    let v = s.query_map([uid], |r| r.get(0))?.collect();
    v
}

fn are_friends(c: &Connection, x: &str, y: &str) -> rusqlite::Result<bool> {
    let (a, b) = db::pair(x, y);
    Ok(c.query_row("SELECT 1 FROM friendships WHERE a=? AND b=?", [a, b], |_| Ok(())).optional()?.is_some())
}

fn blocked_either(c: &Connection, x: &str, y: &str) -> rusqlite::Result<bool> {
    Ok(c.query_row(
        "SELECT 1 FROM blocks WHERE (user_id=?1 AND blocked_id=?2) OR (user_id=?2 AND blocked_id=?1)",
        [x, y],
        |_| Ok(()),
    )
    .optional()?
    .is_some())
}

fn friend_view(st: &AppState, c: &Connection, viewer: &str, other: &str) -> R<Friend> {
    let (a, b) = db::pair(viewer, other);
    let today = now_ms() / 86_400_000;
    c.query_row(
        &format!(
            "SELECT {USER_COLS}, u.dnd, f.created_at,
             CASE WHEN COALESCE(s.day, 0)>=?4 THEN COALESCE(s.current, 0) ELSE 0 END,
             COALESCE(s.last_talked, 0)
             FROM friendships f JOIN users u ON u.id=?3
             LEFT JOIN streaks s ON s.a=f.a AND s.b=f.b
             WHERE f.a=?1 AND f.b=?2"
        ),
        params![a, b, other, today - 1],
        |r| {
            Ok(Friend {
                user: row_user(r, 0)?,
                online: st.hub.online(other),
                dnd: r.get::<_, i64>(6)? != 0,
                since: r.get(7)?,
                streak: r.get(8)?,
                last_talked_at: r.get(9)?,
            })
        },
    )
    .optional()?
    .ok_or_else(not_friends)
}

fn status_event(st: &AppState, uid: &str, dnd: bool) -> Value {
    json!({ "type": "friend_status_updated", "user_id": uid, "online": st.hub.online(uid), "dnd": dnd })
}

fn broadcast_streak(st: &S, me: &str, other: &str, streak: i64, last_talked_at: i64) {
    st.hub.send(me, &json!({ "type": "streak_updated", "user_id": other, "streak": streak, "last_talked_at": last_talked_at }));
    st.hub.send(other, &json!({ "type": "streak_updated", "user_id": me, "streak": streak, "last_talked_at": last_talked_at }));
}

fn broadcast_status(st: &S, uid: &str) {
    let r = (|| -> R<(Vec<String>, bool)> {
        let c = st.db();
        let dnd: i64 = c.query_row("SELECT dnd FROM users WHERE id=?", [uid], |r| r.get(0)).optional()?.unwrap_or(0);
        Ok((friend_ids(&c, uid)?, dnd != 0))
    })();
    if let Ok((ids, dnd)) = r {
        let ev = status_event(st, uid, dnd);
        for f in ids {
            st.hub.send(&f, &ev);
        }
    }
}

fn label(u: &PublicUser) -> String {
    if !u.display_name.is_empty() {
        u.display_name.clone()
    } else {
        u.username.clone().unwrap_or_else(|| "Someone".into())
    }
}

/// Fire-and-forget Expo push to every device of `user`.
fn push(st: &S, user: &str, title: String, body: String, data: Value) {
    let tokens: Vec<String> = {
        let c = st.db();
        let kind = data["type"].as_str().unwrap_or("");
        let col = match kind {
            "message" | "group_message" => "messages",
            "ptt" | "poke" | "wave" => "talk",
            "call" => "calls",
            "friend_request" | "friendship_created" => "friends",
            _ => "",
        };
        if !col.is_empty() {
            let on: i64 = c.query_row(&format!("SELECT {col} FROM notif_prefs WHERE user_id=?"), [user], |r| r.get(0)).unwrap_or(1);
            if on == 0 { return; }
        }
        if matches!(kind, "message" | "group_message" | "ptt" | "poke" | "wave") {
            let chat = data["group_id"].as_str().map(|g| format!("g:{g}")).or_else(|| data["from"].as_str().map(String::from));
            if let Some(ch) = chat {
                if c.query_row("SELECT 1 FROM mutes WHERE user_id=? AND chat=?", [user, ch.as_str()], |_| Ok(())).is_ok() { return; }
            }
        }
        let Ok(mut s) = c.prepare("SELECT token FROM devices WHERE user_id=?") else { return };
        let Ok(rows) = s.query_map([user], |r| r.get(0)) else { return };
        rows.filter_map(Result::ok).collect()
    };
    if tokens.is_empty() {
        return;
    }
    let st = st.clone();
    tokio::spawn(async move {
        let msgs: Vec<Value> = tokens
            .iter()
            .map(|t| {
                json!({
                    "to": t, "title": title, "body": body, "data": data,
                    "sound": "default", "priority": "high", "channelId": "yap",
                    "interruptionLevel": "time-sensitive",
                })
            })
            .collect();
        match st.http.post("https://exp.host/--/api/v2/push/send").json(&msgs).send().await {
            Ok(r) => {
                if let Ok(v) = r.json::<Value>().await {
                    if let Some(arr) = v["data"].as_array() {
                        for (i, t) in arr.iter().enumerate() {
                            if t["details"]["error"] == "DeviceNotRegistered" {
                                if let Some(tok) = tokens.get(i) {
                                    let _ = st.db().execute("DELETE FROM devices WHERE token=?", [tok]);
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => tracing::warn!(error = %e, "expo push failed"),
        }
    });
}

// ---------- notification settings ----------

#[derive(Deserialize)]
struct Prefs {
    messages: bool,
    talk: bool,
    calls: bool,
    friends: bool,
}

async fn get_notifs(State(st): State<S>, Authed(me): Authed) -> R<Json<Value>> {
    let c = st.db();
    let prefs = c
        .query_row("SELECT messages, talk, calls, friends FROM notif_prefs WHERE user_id=?", [&me], |r| {
            Ok(json!({ "messages": r.get::<_, i64>(0)? != 0, "talk": r.get::<_, i64>(1)? != 0, "calls": r.get::<_, i64>(2)? != 0, "friends": r.get::<_, i64>(3)? != 0 }))
        })
        .optional()?
        .unwrap_or_else(|| json!({ "messages": true, "talk": true, "calls": true, "friends": true }));
    let mut q = c.prepare("SELECT chat FROM mutes WHERE user_id=?")?;
    let muted: Vec<String> = q.query_map([&me], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(Json(json!({ "prefs": prefs, "muted": muted })))
}

async fn put_notifs(State(st): State<S>, Authed(me): Authed, Json(p): Json<Prefs>) -> R<Json<Value>> {
    st.db().execute(
        "INSERT INTO notif_prefs(user_id, messages, talk, calls, friends) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(user_id) DO UPDATE SET messages=?2, talk=?3, calls=?4, friends=?5",
        params![me, p.messages, p.talk, p.calls, p.friends],
    )?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct MuteReq {
    chat: String,
    muted: bool,
}

async fn put_mute(State(st): State<S>, Authed(me): Authed, Json(r): Json<MuteReq>) -> R<Json<Value>> {
    if r.chat.is_empty() || r.chat.len() > 40 { return Err(bad("Unknown chat")); }
    let c = st.db();
    if r.muted {
        c.execute("INSERT OR IGNORE INTO mutes(user_id, chat) VALUES (?,?)", params![me, r.chat])?;
    } else {
        c.execute("DELETE FROM mutes WHERE user_id=? AND chat=?", params![me, r.chat])?;
    }
    Ok(Json(json!({ "ok": true })))
}

// ---------- auth ----------

#[derive(Deserialize)]
struct StartReq {
    email: String,
}

async fn auth_start(State(st): State<S>, Json(r): Json<StartReq>) -> R<Json<Value>> {
    let email = normalize_email(&r.email).ok_or_else(|| bad("Enter a valid email"))?;
    if is_banned(&st.db(), &email)? {
        return Err(err(StatusCode::FORBIDDEN, "Banned", "This email was banned from Yapp"));
    }
    if st.cfg.review_code(&email).is_some() {
        return Ok(Json(json!({ "ok": true })));
    }
    let key = st
        .cfg
        .mail_api_key
        .clone()
        .ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "Unavailable", "Email sign-in is not configured"))?;
    let n = now();
    let code = random_code();
    {
        let c = st.db();
        let row: Option<(i64, i64, i64)> = c
            .query_row(
                "SELECT sent_at, window_start, window_count FROM login_codes WHERE email=?",
                [&email],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let (ws, wc) = match row {
            Some((sent, _, _)) if n - sent < 30 => return Err(too_many("Wait a few seconds before asking for another code")),
            Some((_, ws, wc)) if n - ws < 3600 => {
                if wc >= 5 {
                    return Err(too_many("Too many codes. Try again in an hour"));
                }
                (ws, wc + 1)
            }
            _ => (n, 1),
        };
        c.execute(
            "INSERT INTO login_codes(email, code_hash, expires_at, attempts, sent_at, window_start, window_count)
             VALUES(?1, ?2, ?3, 0, ?4, ?5, ?6)
             ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at,
               attempts=0, sent_at=excluded.sent_at, window_start=excluded.window_start, window_count=excluded.window_count",
            params![email, st.code_hash(&email, &code), n + 600, n, ws, wc],
        )?;
    }
    let html = format!(
        r#"<!doctype html><html><body style="margin:0;background:#000;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:420px;margin:0 auto;padding:48px 28px">
<div style="font-size:22px;font-weight:700;letter-spacing:-0.5px">yapp</div>
<div style="margin-top:36px;color:#8a8a8a;font-size:15px">Your sign-in code</div>
<div style="margin-top:10px;font-size:44px;font-weight:700;letter-spacing:10px;font-family:ui-monospace,Menlo,monospace">{code}</div>
<div style="margin-top:28px;color:#5a5a5a;font-size:13px;line-height:1.5">It expires in 10 minutes. If you didn't ask for it, ignore this email.</div>
</div></body></html>"#
    );
    let res = st
        .http
        .post(&st.cfg.mail_api_url)
        .bearer_auth(key)
        .header("Idempotency-Key", uuid::Uuid::new_v4().to_string())
        .json(&json!({
            "to": email,
            "subject": format!("{code} is your Yapp code"),
            "text": format!("Your Yapp sign-in code is {code}. It expires in 10 minutes."),
            "html": html,
            "fromName": "Yapp",
        }))
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => Ok(Json(json!({ "ok": true }))),
        Ok(r) => {
            tracing::error!(status = %r.status(), "mail api rejected code");
            Err(err(StatusCode::BAD_GATEWAY, "InternalServerError", "Couldn't send the email. Try again"))
        }
        Err(e) => {
            tracing::error!(error = %e, "mail api unreachable");
            Err(err(StatusCode::BAD_GATEWAY, "InternalServerError", "Couldn't send the email. Try again"))
        }
    }
}

#[derive(Deserialize)]
struct ConfirmReq {
    email: String,
    code: String,
}

#[derive(Serialize)]
struct TokenResp {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: Me,
}

fn issue_tokens(st: &AppState, c: &Connection, uid: &str) -> R<TokenResp> {
    let refresh = random_token();
    c.execute(
        "INSERT INTO refresh_tokens(token_hash, user_id, expires_at) VALUES(?, ?, ?)",
        params![sha256(&refresh), uid, now() + REFRESH_TTL],
    )?;
    c.execute("DELETE FROM refresh_tokens WHERE expires_at < ?", [now()])?;
    Ok(TokenResp { access_token: st.access_token(uid), refresh_token: refresh, expires_in: ACCESS_TTL, user: me_of(c, uid)? })
}

// ---------- Google sign-in (Firebase Auth popup on our own page, then a one-time code back into the app) ----------

static GOOGLE_CODES: std::sync::LazyLock<parking_lot::Mutex<std::collections::HashMap<String, (String, Instant)>>> =
    std::sync::LazyLock::new(Default::default);
static FIREBASE_KEYS: std::sync::LazyLock<parking_lot::Mutex<(Vec<(String, String, String)>, Option<Instant>)>> =
    std::sync::LazyLock::new(Default::default);

async fn firebase_key(st: &S, kid: &str) -> Option<(String, String)> {
    let fresh = |k: &(Vec<(String, String, String)>, Option<Instant>)| k.1.is_some_and(|t| t.elapsed() < Duration::from_secs(3600));
    {
        let k = FIREBASE_KEYS.lock();
        if fresh(&k) {
            if let Some(x) = k.0.iter().find(|x| x.0 == kid) { return Some((x.1.clone(), x.2.clone())); }
        }
    }
    let url = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
    let v: Value = st.http.get(url).send().await.ok()?.json().await.ok()?;
    let keys: Vec<(String, String, String)> = v["keys"].as_array()?.iter().filter_map(|k| Some((k["kid"].as_str()?.into(), k["n"].as_str()?.into(), k["e"].as_str()?.into()))).collect();
    let hit = keys.iter().find(|x| x.0 == kid).map(|x| (x.1.clone(), x.2.clone()));
    *FIREBASE_KEYS.lock() = (keys, Some(Instant::now()));
    hit
}

fn google_page(st: &S) -> String {
    let cfg = match (&st.cfg.fb_api_key, &st.cfg.fb_app_id) {
        (Some(k), Some(a)) => json!({ "apiKey": k, "appId": a, "projectId": st.cfg.fb_project, "authDomain": format!("{}.firebaseapp.com", st.cfg.fb_project) }).to_string(),
        _ => "null".into(),
    };
    format!(r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Sign in to Yapp</title><meta name="theme-color" content="#000"><meta name="robots" content="noindex"><style>
*{{margin:0;box-sizing:border-box}}html,body{{height:100%;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}}
main{{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;text-align:center}}
h1{{font-size:44px;font-weight:900;letter-spacing:-1px}}p{{color:rgba(255,255,255,.55);font-size:17px;min-height:22px}}
button,a.b{{margin-top:18px;display:block;width:100%;max-width:320px;height:56px;line-height:56px;border:0;border-radius:28px;background:#fff;color:#000;font:900 18px -apple-system,BlinkMacSystemFont,sans-serif;text-decoration:none;cursor:pointer;transition:transform .15s,opacity .2s}}
button:active{{transform:scale(.97)}}button:disabled{{opacity:.5}}
</style></head><body><main><h1>yapp</h1><p id="m">sign in with your google account</p><button id="go">continue with google</button></main>
<script type="module">
const cfg = {cfg};
const m = document.getElementById('m'), go = document.getElementById('go');
if (!cfg) {{ m.textContent = 'google sign in is not set up yet'; go.remove(); }}
else {{
  const {{ initializeApp }} = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
  const {{ getAuth, GoogleAuthProvider, signInWithPopup }} = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
  const auth = getAuth(initializeApp(cfg));
  go.onclick = async () => {{
    go.disabled = true; m.textContent = 'signing in…';
    try {{
      const r = await signInWithPopup(auth, new GoogleAuthProvider());
      const res = await fetch('/v1/auth/google', {{ method: 'POST', headers: {{ 'content-type': 'application/json' }}, body: JSON.stringify({{ id_token: await r.user.getIdToken() }}) }});
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || 'sign in failed');
      m.textContent = 'opening yapp…';
      const url = 'yapp://auth?code=' + encodeURIComponent(j.code);
      location.href = url;
      go.textContent = 'open yapp'; go.disabled = false; go.onclick = () => {{ location.href = url; }};
    }} catch (e) {{
      go.disabled = false;
      m.textContent = e && e.code === 'auth/popup-closed-by-user' ? 'sign in with your google account' : String((e && e.message) || 'sign in failed').toLowerCase();
    }}
  }};
}}
</script></body></html>"##)
}

async fn google_signin_page(State(st): State<S>) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Html(google_page(&st))).into_response()
}

#[derive(Deserialize)]
struct GoogleReq {
    id_token: String,
}

/// Verifies a Firebase ID token and hands back a 2-minute one-time code for the app.
async fn auth_google(State(st): State<S>, Json(r): Json<GoogleReq>) -> R<Json<Value>> {
    let bad_token = || err(StatusCode::UNAUTHORIZED, "BadToken", "Google sign in failed, try again");
    let head = jsonwebtoken::decode_header(&r.id_token).map_err(|_| bad_token())?;
    let kid = head.kid.ok_or_else(bad_token)?;
    let (n, e) = firebase_key(&st, &kid).await.ok_or_else(bad_token)?;
    let key = jsonwebtoken::DecodingKey::from_rsa_components(&n, &e).map_err(|_| bad_token())?;
    let mut val = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    val.set_audience(&[&st.cfg.fb_project]);
    val.set_issuer(&[format!("https://securetoken.google.com/{}", st.cfg.fb_project)]);
    let claims = jsonwebtoken::decode::<Value>(&r.id_token, &key, &val).map_err(|_| bad_token())?.claims;
    if claims["email_verified"] != json!(true) {
        return Err(bad("That Google account has no verified email"));
    }
    let email = claims["email"].as_str().and_then(normalize_email).ok_or_else(|| bad("That Google account has no email"))?;
    let code = google_login(&st, &email, claims["name"].as_str().unwrap_or(""))?;
    Ok(Json(json!({ "code": code })))
}

/// Finds or creates the account for a verified Google email and returns a 2-minute one-time code.
fn google_login(st: &S, email: &str, name: &str) -> R<String> {
    let name: String = name.chars().take(30).collect();
    let uid = {
        let c = st.db();
        if is_banned(&c, &email)? {
            return Err(err(StatusCode::FORBIDDEN, "Banned", "This email was banned from Yapp"));
        }
        match c.query_row("SELECT id FROM users WHERE email=?", [&email], |r| r.get::<_, String>(0)).optional()? {
            Some(id) => id,
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                c.execute("INSERT INTO users(id, email, display_name, color, created_at) VALUES(?, ?, ?, ?, ?)", params![id, email, name, random_color(), now()])?;
                id
            }
        }
    };
    let code = random_token();
    let mut codes = GOOGLE_CODES.lock();
    codes.retain(|_, v| v.1.elapsed() < Duration::from_secs(120));
    codes.insert(code.clone(), (uid, Instant::now()));
    Ok(code)
}

const GOOGLE_CB: &str = "https://yap.kreatix.dev/auth/google/cb";

fn auth_page(title: &str, msg: &str, action: Option<&str>) -> Response {
    let (t, m) = (esc(title), esc(msg));
    let (btn, go) = match action {
        Some(u) => { let u = esc(u); (format!(r#"<a href="{u}">open yapp</a>"#), format!(r#"<script>location.replace("{u}")</script>"#)) }
        None => (r#"<a href="/auth/google">try again</a>"#.to_string(), String::new()),
    };
    let page = format!(r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>{t}</title><meta name="theme-color" content="#000"><style>
*{{margin:0;box-sizing:border-box}}html,body{{height:100%;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}}
main{{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;text-align:center}}
h1{{font-size:44px;font-weight:900;letter-spacing:-1px}}p{{color:rgba(255,255,255,.55);font-size:17px}}
a{{margin-top:18px;display:block;width:100%;max-width:320px;height:56px;line-height:56px;border-radius:28px;background:#fff;color:#000;font-weight:900;font-size:18px;text-decoration:none}}
</style></head><body><main><h1>yapp</h1><p>{m}</p>{btn}</main>{go}</body></html>"##);
    ([(header::CACHE_CONTROL, "no-store")], Html(page)).into_response()
}

/// Step 1: ask Firebase for Google's login URL (coming back to our own callback) and send the browser there.
async fn google_start(State(st): State<S>) -> Response {
    let Some(key) = st.cfg.fb_api_key.clone() else { return auth_page("Sign in to Yapp", "google sign in is not set up yet", None) };
    let res = st
        .http
        .post(format!("https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key={key}"))
        .header(header::REFERER, "https://yap.kreatix.dev/")
        .json(&json!({ "providerId": "google.com", "continueUri": GOOGLE_CB, "customParameter": { "prompt": "select_account" } }))
        .send()
        .await;
    let v: Value = match res { Ok(r) => r.json().await.unwrap_or_default(), Err(_) => Value::Null };
    let (Some(url), Some(sid)) = (v["authUri"].as_str(), v["sessionId"].as_str()) else {
        tracing::warn!(error = %v["error"]["message"], "createAuthUri failed");
        return auth_page("Sign in to Yapp", "couldn't reach google, try again", None);
    };
    let cookie = format!("yg={sid}; Path=/auth/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax");
    (StatusCode::FOUND, [(header::LOCATION, url.to_string()), (header::SET_COOKIE, cookie), (header::CACHE_CONTROL, "no-store".into())]).into_response()
}

/// Step 2: Google sends the browser back here; Firebase checks it and tells us who it is.
async fn google_cb(State(st): State<S>, headers: HeaderMap, uri: axum::http::Uri) -> Response {
    let fail = |m: &str| auth_page("Sign in to Yapp", m, None);
    let Some(key) = st.cfg.fb_api_key.clone() else { return fail("google sign in is not set up yet") };
    let sid = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|h| h.to_str().ok())
        .flat_map(|h| h.split(';'))
        .find_map(|c| c.trim().strip_prefix("yg=").map(String::from));
    let Some(sid) = sid else { return fail("that sign in expired, try again") };
    let query = uri.query().unwrap_or("");
    if !query.contains("id_token=") && !query.contains("code=") {
        // Google returns the token in the URL fragment, which never reaches the server: hop it into the query.
        let page = r#"<!doctype html><meta name="viewport" content="width=device-width"><body style="background:#000"><script>
location.hash.length > 1 ? location.replace("/auth/google/cb?" + location.hash.slice(1)) : location.replace("/auth/google/cb?error=none")
</script>"#;
        if !query.contains("error=") {
            return ([(header::CACHE_CONTROL, "no-store")], Html(page)).into_response();
        }
        return fail("google sign in was canceled, try again");
    }
    let request_uri = format!("{GOOGLE_CB}#{query}");
    let res = st
        .http
        .post(format!("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={key}"))
        .header(header::REFERER, "https://yap.kreatix.dev/")
        .json(&json!({ "requestUri": request_uri, "sessionId": sid, "returnSecureToken": true, "returnIdpCredential": true }))
        .send()
        .await;
    let v: Value = match res { Ok(r) => r.json().await.unwrap_or_default(), Err(_) => Value::Null };
    let Some(email) = v["email"].as_str().and_then(normalize_email) else {
        tracing::warn!(error = %v["error"]["message"], "signInWithIdp failed");
        return fail("google sign in failed, try again");
    };
    if v["emailVerified"] != json!(true) {
        return fail("that google account has no verified email");
    }
    match google_login(&st, &email, v["displayName"].as_str().unwrap_or("")) {
        Ok(code) => auth_page("Opening Yapp", "opening yapp…", Some(&format!("yapp://auth?code={code}"))),
        Err(_) => fail("this account can't sign in to yapp"),
    }
}

#[derive(Deserialize)]
struct ExchangeReq {
    code: String,
}

async fn auth_exchange(State(st): State<S>, Json(r): Json<ExchangeReq>) -> R<Json<TokenResp>> {
    let hit = GOOGLE_CODES.lock().remove(&r.code).filter(|v| v.1.elapsed() < Duration::from_secs(120));
    let Some((uid, _)) = hit else { return Err(bad("That sign in expired, try again")) };
    let c = st.db();
    Ok(Json(issue_tokens(&st, &c, &uid)?))
}

async fn auth_confirm(State(st): State<S>, Json(r): Json<ConfirmReq>) -> R<Json<TokenResp>> {
    let email = normalize_email(&r.email).ok_or_else(|| bad("Enter a valid email"))?;
    if is_banned(&st.db(), &email)? {
        return Err(err(StatusCode::FORBIDDEN, "Banned", "This email was banned from Yapp"));
    }
    let code = r.code.trim();
    let c = st.db();
    if let Some(rc) = st.cfg.review_code(&email) {
        if rc != code {
            return Err(bad("Wrong code"));
        }
    } else {
        let row: Option<(String, i64, i64)> = c
            .query_row("SELECT code_hash, expires_at, attempts FROM login_codes WHERE email=?", [&email], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()?;
        let Some((h, exp, att)) = row else { return Err(bad("Ask for a new code")) };
        if now() > exp || att >= 5 {
            c.execute("UPDATE login_codes SET expires_at=0 WHERE email=?", [&email])?;
            return Err(bad("That code expired. Ask for a new one"));
        }
        if h != st.code_hash(&email, code) {
            c.execute("UPDATE login_codes SET attempts=attempts+1 WHERE email=?", [&email])?;
            return Err(bad("Wrong code"));
        }
        c.execute("UPDATE login_codes SET expires_at=0 WHERE email=?", [&email])?;
    }
    let uid: String = match c.query_row("SELECT id FROM users WHERE email=?", [&email], |r| r.get(0)).optional()? {
        Some(id) => id,
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            c.execute(
                "INSERT INTO users(id, email, color, created_at) VALUES(?, ?, ?, ?)",
                params![id, email, random_color(), now()],
            )?;
            id
        }
    };
    Ok(Json(issue_tokens(&st, &c, &uid)?))
}

#[derive(Deserialize)]
struct RefreshReq {
    refresh_token: String,
}

async fn auth_refresh(State(st): State<S>, Json(r): Json<RefreshReq>) -> R<Json<TokenResp>> {
    let c = st.db();
    let h = sha256(&r.refresh_token);
    let row: Option<(String, i64)> = c
        .query_row("SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash=?", [&h], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    c.execute("DELETE FROM refresh_tokens WHERE token_hash=?", [&h])?;
    let Some((uid, exp)) = row else { return Err(unauthorized()) };
    if exp < now() {
        return Err(unauthorized());
    }
    Ok(Json(issue_tokens(&st, &c, &uid)?))
}

async fn auth_logout(State(st): State<S>, Json(r): Json<RefreshReq>) -> R<Json<Value>> {
    st.db().execute("DELETE FROM refresh_tokens WHERE token_hash=?", [sha256(&r.refresh_token)])?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct VersionQ {
    build: Option<i64>,
}

async fn version(State(st): State<S>, Query(q): Query<VersionQ>) -> Json<Value> {
    let outdated = q.build.is_some_and(|b| b < st.cfg.min_build);
    Json(json!({ "min_build": st.cfg.min_build, "outdated": outdated }))
}

// ---------- profile ----------

async fn get_me(State(st): State<S>, Authed(uid): Authed) -> R<Json<Me>> {
    Ok(Json(me_of(&st.db(), &uid)?))
}

#[derive(Deserialize)]
struct PatchMe {
    username: Option<String>,
    display_name: Option<String>,
    color: Option<i64>,
}

async fn patch_me(State(st): State<S>, Authed(uid): Authed, Json(p): Json<PatchMe>) -> R<Json<Me>> {
    let (me, friends) = {
        let c = st.db();
        if let Some(u) = p.username {
            let u = u.trim().trim_start_matches('@').to_lowercase();
            if !valid_username(&u) {
                return Err(bad("Usernames are 3-20 letters, numbers, _ or ."));
            }
            match c.execute("UPDATE users SET username=? WHERE id=?", [&u, &uid]) {
                Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == ErrorCode::ConstraintViolation => {
                    return Err(err(StatusCode::CONFLICT, "AlreadyTaken", "That username is taken"));
                }
                r => {
                    r?;
                }
            }
        }
        if let Some(n) = p.display_name {
            let n = n.trim().to_string();
            if n.is_empty() || n.chars().count() > 32 {
                return Err(bad("Names are 1-32 characters"));
            }
            c.execute("UPDATE users SET display_name=? WHERE id=?", [&n, &uid])?;
        }
        if let Some(col) = p.color {
            if !(0..8).contains(&col) {
                return Err(bad("Unknown color"));
            }
            c.execute("UPDATE users SET color=? WHERE id=?", params![col, uid])?;
        }
        (me_of(&c, &uid)?, friend_ids(&c, &uid)?)
    };
    let ev = json!({
        "type": "friend_profile_updated",
        "user": PublicUser { id: me.id.clone(), username: me.username.clone(), display_name: me.display_name.clone(), color: me.color, avatar: me.avatar.clone(), pfp: me.pfp.clone() },
    });
    for f in friends {
        st.hub.send(&f, &ev);
    }
    Ok(Json(me))
}

async fn delete_me(State(st): State<S>, Authed(uid): Authed) -> R<Json<Value>> {
    delete_account(&st, &uid)?;
    Ok(Json(json!({ "ok": true })))
}

fn delete_account(st: &S, uid: &str) -> R<()> {
    let friends = {
        let c = st.db();
        let f = friend_ids(&c, uid)?;
        let (av, pf): (Option<String>, Option<String>) = c.query_row("SELECT avatar, pfp FROM users WHERE id=?", [uid], |r| Ok((r.get(0)?, r.get(1)?)))?;
        for a in [av, pf].into_iter().flatten() {
            let _ = std::fs::remove_file(std::path::Path::new(&st.cfg.avatar_dir).join(a));
        }
        let mut q = c.prepare("SELECT body FROM messages WHERE (kind='image' OR kind='sticker') AND (a=?1 OR b=?1)")?;
        let media: Vec<String> = q.query_map([uid], |r| r.get(0))?.collect::<Result<_, _>>()?;
        drop(q);

        // Find all sticker IDs in packs authored by this user
        let mut sq = c.prepare(
            "SELECT i.sticker_id FROM sticker_pack_items i
             JOIN sticker_packs p ON p.id = i.pack_id
             WHERE p.owner_id = ?",
        )?;
        let pack_stickers: Vec<String> = sq.query_map([uid], |r| r.get(0))?.collect::<Result<_, _>>()?;
        drop(sq);

        // Delete authored packs (cascades to sticker_pack_items)
        c.execute("DELETE FROM sticker_packs WHERE owner_id=?", [uid])?;
        c.execute("DELETE FROM user_recent_stickers WHERE user_id=?", [uid])?;
        c.execute("DELETE FROM user_installed_packs WHERE user_id=?", [uid])?;

        c.execute("DELETE FROM messages WHERE a=?1 OR b=?1", [uid])?;
        c.execute("DELETE FROM chat_meta WHERE a=?1 OR b=?1", [uid])?;
        c.execute("DELETE FROM chat_reads WHERE friend_id=?", [uid])?;
        let mut s = c.prepare("SELECT id FROM clips WHERE from_id=?1 OR to_id=?1")?;
        let clips: Vec<String> = s.query_map([uid], |r| r.get(0))?.collect::<Result<_, _>>()?;
        drop(s);
        c.execute("DELETE FROM users WHERE id=?", [uid])?;
        if !clips.is_empty() {
            recorder(st, "/delete", json!({ "ids": clips }));
        }
        let all_media: Vec<String> = media.into_iter().chain(pack_stickers).collect();
        if !all_media.is_empty() {
            let st = st.clone();
            tokio::spawn(async move { for k in all_media { drop_media(&st, k).await; } });
        }
        f
    };
    for f in friends {
        st.hub.send(&f, &json!({ "type": "friendship_deleted", "user_id": uid }));
    }
    Ok(())
}

#[derive(Deserialize)]
struct StatusReq {
    dnd: bool,
}

async fn set_status(State(st): State<S>, Authed(uid): Authed, Json(r): Json<StatusReq>) -> R<Json<Me>> {
    let me = {
        let c = st.db();
        c.execute("UPDATE users SET dnd=? WHERE id=?", params![r.dnd as i64, uid])?;
        me_of(&c, &uid)?
    };
    broadcast_status(&st, &uid);
    Ok(Json(me))
}

fn valid_avatar_name(f: &str) -> bool {
    f.len() <= 64
        && (f.strip_suffix(".jpg").or_else(|| f.strip_suffix(".webp")))
            .is_some_and(|b| !b.is_empty() && b.chars().all(|c| c.is_ascii_hexdigit() || c == '-' || c == 'p' || c == 'q'))
}

async fn put_avatar(State(st): State<S>, Authed(uid): Authed, body: axum::body::Bytes) -> R<Json<Me>> {
    save_photo(&st, &uid, &body, false).await
}

async fn put_pfp(State(st): State<S>, Authed(uid): Authed, body: axum::body::Bytes) -> R<Json<Me>> {
    save_photo(&st, &uid, &body, true).await
}

/// The full 9:16 photo lives in `avatar`, the square crop in `pfp`. A new full photo clears the old crop.
async fn save_photo(st: &S, uid: &str, body: &[u8], square: bool) -> R<Json<Me>> {
    let Some((ext, ctype)) = crate::storage::image_kind(body).filter(|_| body.len() >= 100) else {
        return Err(bad("Upload a JPEG or WebP photo"));
    };
    let dir = std::path::PathBuf::from(&st.cfg.avatar_dir);
    let name = if let Some(store) = crate::storage::get() {
        let key = crate::storage::key_for(if square { "q" } else { "p" }, body, ext);
        store.put(&key, body.to_vec(), ctype).await.map_err(|e| { tracing::error!(error = %e, "b2 put"); bad("Couldn't save photo") })?;
        key
    } else {
        let name = format!("{uid}-{}.{ext}", &random_token()[..12]);
        tokio::fs::create_dir_all(&dir).await.map_err(|e| { tracing::error!(error = %e, "avatar dir"); bad("Couldn't save photo") })?;
        tokio::fs::write(dir.join(&name), body).await.map_err(|e| { tracing::error!(error = %e, "avatar write"); bad("Couldn't save photo") })?;
        name
    };
    let (old, me, friends) = {
        let c = st.db();
        let (av, pf): (Option<String>, Option<String>) = c.query_row("SELECT avatar, pfp FROM users WHERE id=?", [uid], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let old: Vec<String> = if square {
            c.execute("UPDATE users SET pfp=? WHERE id=?", [&name, uid])?;
            pf.into_iter().collect()
        } else {
            c.execute("UPDATE users SET avatar=?, pfp=NULL WHERE id=?", [&name, uid])?;
            [av, pf].into_iter().flatten().collect()
        };
        (old, me_of(&c, uid)?, friend_ids(&c, uid)?)
    };
    for o in old.into_iter().filter(|o| *o != name) {
        drop_media(st, o).await;
    }
    let ev = json!({
        "type": "friend_profile_updated",
        "user": PublicUser { id: me.id.clone(), username: me.username.clone(), display_name: me.display_name.clone(), color: me.color, avatar: me.avatar.clone(), pfp: me.pfp.clone() },
    });
    for f in friends {
        st.hub.send(&f, &ev);
    }
    Ok(Json(me))
}

/// Delete a photo/background/chat image/sticker once nothing references it any more.
async fn drop_media(st: &S, key: String) {
    let used: i64 = st
        .db()
        .query_row(
            "SELECT (SELECT COUNT(*) FROM users WHERE avatar=?1 OR pfp=?1) + \
                    (SELECT COUNT(*) FROM chat_meta WHERE background=?1) + \
                    (SELECT COUNT(*) FROM groups WHERE background=?1) + \
                    (SELECT COUNT(*) FROM messages WHERE (kind='image' OR kind='sticker') AND body=?1) + \
                    (SELECT COUNT(*) FROM sticker_pack_items WHERE sticker_id=?1) + \
                    (SELECT COUNT(*) FROM user_recent_stickers WHERE sticker_id=?1)",
            [&key],
            |r| r.get(0),
        )
        .unwrap_or(1);
    if used > 0 {
        return;
    }
    if key.starts_with("p-") || key.starts_with("q-") || key.starts_with("b-") || key.starts_with("c-") || key.starts_with("s-") {
        if let Some(store) = crate::storage::get() {
            store.delete(&key).await;
        }
        let _ = st.db().execute("DELETE FROM media_meta WHERE key=?", [&key]);
        let _ = st.db().execute("DELETE FROM stickers WHERE id=?", [&key]);
    } else if valid_avatar_name(&key) {
        let _ = tokio::fs::remove_file(std::path::Path::new(&st.cfg.avatar_dir).join(key)).await;
    }
}

async fn get_avatar(State(st): State<S>, Path(file): Path<String>) -> Response {
    if !valid_avatar_name(&file) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if file.starts_with("p-") || file.starts_with("q-") {
        if let Some(store) = crate::storage::get() {
            return axum::response::Redirect::permanent(&store.url(&file)).into_response();
        }
    }
    match tokio::fs::read(std::path::Path::new(&st.cfg.avatar_dir).join(&file)).await {
        Ok(b) => (
            [("content-type", "image/jpeg"), ("cache-control", "public, max-age=31536000, immutable")],
            b,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ---------- friends ----------

async fn lookup_user(State(st): State<S>, Authed(me): Authed, Path(username): Path<String>) -> R<Json<PublicUser>> {
    let u = username.trim().trim_start_matches('@').to_lowercase();
    let c = st.db();
    c.query_row(&format!("SELECT {USER_COLS} FROM users u WHERE u.username=?"), [&u], |r| row_user(r, 0))
        .optional()?
        .filter(|p| !blocked_either(&c, &me, &p.id).unwrap_or(true))
        .map(Json)
        .ok_or_else(|| not_found("No one has that username"))
}

fn friend_list<F>(c: &Connection, uid: &str, online: F) -> R<Vec<Friend>>
where
    F: Fn(&str) -> bool,
{
    let today = now_ms() / 86_400_000;
    let mut s = c.prepare(&format!(
        "SELECT {USER_COLS}, u.dnd, f.created_at,
         CASE WHEN COALESCE(s.day, 0)>=?2 THEN COALESCE(s.current, 0) ELSE 0 END,
         COALESCE(s.last_talked, 0)
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.a=?1 THEN f.b ELSE f.a END
         LEFT JOIN streaks s ON s.a=f.a AND s.b=f.b
         LEFT JOIN friend_order o ON o.user_id=?1 AND o.friend_id=u.id
         WHERE f.a=?1 OR f.b=?1 ORDER BY (o.pos IS NULL), o.pos, f.created_at ASC"
    ))?;
    let v = s
        .query_map(params![uid, today - 1], |r| {
            let user = row_user(r, 0)?;
            Ok(Friend {
                online: online(&user.id),
                user,
                dnd: r.get::<_, i64>(6)? != 0,
                since: r.get(7)?,
                streak: r.get(8)?,
                last_talked_at: r.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

async fn list_friends(State(st): State<S>, Authed(uid): Authed) -> R<Json<Vec<Friend>>> {
    let c = st.db();
    Ok(Json(friend_list(&c, &uid, |id| st.hub.online(id))?))
}

#[derive(Deserialize)]
struct FriendOrderReq {
    ids: Vec<String>,
}

fn save_friend_order(c: &Connection, uid: &str, ids: &[String]) -> rusqlite::Result<()> {
    let tx = c.unchecked_transaction()?;
    tx.execute("DELETE FROM friend_order WHERE user_id=?", [uid])?;
    let mut seen = HashSet::new();
    for (pos, friend_id) in ids.iter().enumerate() {
        if !seen.insert(friend_id.as_str()) {
            continue;
        }
        let is_friend: i64 = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM friendships WHERE (a=?1 AND b=?2) OR (a=?2 AND b=?1))",
            params![uid, friend_id],
            |r| r.get(0),
        )?;
        if is_friend != 0 {
            tx.execute(
                "INSERT INTO friend_order(user_id, friend_id, pos) VALUES (?1, ?2, ?3)",
                params![uid, friend_id, pos as i64],
            )?;
        }
    }
    tx.commit()
}

async fn update_friend_order(
    State(st): State<S>,
    Authed(uid): Authed,
    Json(r): Json<FriendOrderReq>,
) -> R<Json<Vec<Friend>>> {
    let c = st.db();
    save_friend_order(&c, &uid, &r.ids)?;
    Ok(Json(friend_list(&c, &uid, |id| st.hub.online(id))?))
}

#[derive(Serialize)]
struct FriendRequest {
    id: String,
    user: PublicUser,
    created_at: i64,
}

fn requests(c: &Connection, uid: &str, incoming: bool) -> rusqlite::Result<Vec<FriendRequest>> {
    let (join, filter) = if incoming { ("from_id", "to_id") } else { ("to_id", "from_id") };
    let mut s = c.prepare(&format!(
        "SELECT r.id, r.created_at, {USER_COLS} FROM friend_requests r JOIN users u ON u.id=r.{join}
         WHERE r.{filter}=? ORDER BY r.created_at DESC"
    ))?;
    let v = s.query_map([uid], |r| Ok(FriendRequest { id: r.get(0)?, created_at: r.get(1)?, user: row_user(r, 2)? }))?.collect();
    v
}

async fn list_requests(State(st): State<S>, Authed(uid): Authed) -> R<Json<Value>> {
    let c = st.db();
    Ok(Json(json!({ "incoming": requests(&c, &uid, true)?, "outgoing": requests(&c, &uid, false)? })))
}

fn befriend(st: &S, c: &Connection, x: &str, y: &str) -> R<(Friend, Friend)> {
    let (a, b) = db::pair(x, y);
    c.execute("INSERT OR IGNORE INTO friendships(a, b, created_at) VALUES(?, ?, ?)", params![a, b, now()])?;
    c.execute(
        "DELETE FROM friend_requests WHERE (from_id=?1 AND to_id=?2) OR (from_id=?2 AND to_id=?1)",
        [x, y],
    )?;
    Ok((friend_view(st, c, x, y)?, friend_view(st, c, y, x)?))
}

#[derive(Deserialize)]
struct SendReq {
    username: String,
}

async fn send_request(State(st): State<S>, Authed(me): Authed, Json(r): Json<SendReq>) -> R<Json<Value>> {
    let uname = r.username.trim().trim_start_matches('@').to_lowercase();
    enum Out {
        Accepted(String, Friend, Friend),
        Sent(String, FriendRequest, PublicUser),
    }
    let out = {
        let c = st.db();
        let target: String = c
            .query_row("SELECT id FROM users WHERE username=?", [&uname], |r| r.get(0))
            .optional()?
            .ok_or_else(|| not_found("No one has that username"))?;
        if target == me {
            return Err(bad("That's you"));
        }
        if blocked_either(&c, &me, &target)? {
            return Err(not_found("No one has that username"));
        }
        if are_friends(&c, &me, &target)? {
            return Err(err(StatusCode::CONFLICT, "AlreadyFriends", "You're already friends"));
        }
        let reverse: Option<String> = c
            .query_row("SELECT id FROM friend_requests WHERE from_id=? AND to_id=?", [&target, &me], |r| r.get(0))
            .optional()?;
        if reverse.is_some() {
            let (mine, theirs) = befriend(&st, &c, &me, &target)?;
            Out::Accepted(target, mine, theirs)
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            c.execute(
                "INSERT OR IGNORE INTO friend_requests(id, from_id, to_id, created_at) VALUES(?, ?, ?, ?)",
                params![id, me, target, now()],
            )?;
            let (id, created_at): (String, i64) = c.query_row(
                "SELECT id, created_at FROM friend_requests WHERE from_id=? AND to_id=?",
                [&me, &target],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let from = public_user(&c, &me)?;
            Out::Sent(target, FriendRequest { id, created_at, user: from.clone() }, from)
        }
    };
    match out {
        Out::Accepted(target, mine, theirs) => {
            let name = label(&theirs.user);
            st.hub.send(&target, &json!({ "type": "friendship_created", "friend": theirs }));
            st.hub.send(&me, &json!({ "type": "friendship_created", "friend": mine }));
            push(&st, &target, name, "You're friends now. Hold to talk".into(), json!({ "type": "friendship_created" }));
            Ok(Json(json!({ "status": "accepted" })))
        }
        Out::Sent(target, req, from) => {
            st.hub.send(&target, &json!({ "type": "friend_request_received", "request": req }));
            push(&st, &target, label(&from), "wants to be friends".into(), json!({ "type": "friend_request" }));
            Ok(Json(json!({ "status": "sent" })))
        }
    }
}

async fn accept_request(State(st): State<S>, Authed(me): Authed, Path(id): Path<String>) -> R<Json<Friend>> {
    let (from, mine, theirs) = {
        let c = st.db();
        let from: String = c
            .query_row("SELECT from_id FROM friend_requests WHERE id=? AND to_id=?", [&id, &me], |r| r.get(0))
            .optional()?
            .ok_or_else(|| not_found("That request is gone"))?;
        let (mine, theirs) = befriend(&st, &c, &me, &from)?;
        (from, mine, theirs)
    };
    st.hub.send(&from, &json!({ "type": "friendship_created", "friend": theirs }));
    st.hub.send(&me, &json!({ "type": "friendship_created", "friend": &mine }));
    push(&st, &from, label(&theirs.user), "accepted your request. Hold to talk".into(), json!({ "type": "friendship_created" }));
    Ok(Json(mine))
}

async fn delete_request(State(st): State<S>, Authed(me): Authed, Path(id): Path<String>) -> R<Json<Value>> {
    let other = {
        let c = st.db();
        let (from, to): (String, String) = c
            .query_row("SELECT from_id, to_id FROM friend_requests WHERE id=?", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?
            .ok_or_else(|| not_found("That request is gone"))?;
        if from != me && to != me {
            return Err(not_found("That request is gone"));
        }
        c.execute("DELETE FROM friend_requests WHERE id=?", [&id])?;
        if from == me { to } else { from }
    };
    let ev = json!({ "type": "friend_request_canceled", "id": id });
    st.hub.send(&other, &ev);
    st.hub.send(&me, &ev);
    Ok(Json(json!({ "ok": true })))
}

async fn remove_friend(State(st): State<S>, Authed(me): Authed, Path(other): Path<String>) -> R<Json<Value>> {
    {
        let (a, b) = db::pair(&me, &other);
        let c = st.db();
        if c.execute("DELETE FROM friendships WHERE a=? AND b=?", [a, b])? == 0 {
            return Err(not_friends());
        }
        c.execute(
            "DELETE FROM friend_order WHERE (user_id=?1 AND friend_id=?2) OR (user_id=?2 AND friend_id=?1)",
            [a, b],
        )?;
        c.execute("DELETE FROM messages WHERE a=? AND b=?", [a, b])?;
        c.execute("DELETE FROM chat_meta WHERE a=? AND b=?", [a, b])?;
    }
    st.hub.send(&other, &json!({ "type": "friendship_deleted", "user_id": me }));
    st.hub.send(&me, &json!({ "type": "friendship_deleted", "user_id": other }));
    Ok(Json(json!({ "ok": true })))
}

// ---------- safety ----------

#[derive(Deserialize)]
struct BlockReq {
    user_id: String,
}

async fn block_user(State(st): State<S>, Authed(me): Authed, Json(r): Json<BlockReq>) -> R<Json<Value>> {
    let other = r.user_id;
    if other == me {
        return Err(bad("That's you"));
    }
    let reqs = {
        let c = st.db();
        c.query_row("SELECT 1 FROM users WHERE id=?", [&other], |_| Ok(()))
            .optional()?
            .ok_or_else(|| not_found("No one like that"))?;
        c.execute("INSERT OR IGNORE INTO blocks(user_id, blocked_id, created_at) VALUES(?, ?, ?)", params![me, other, now()])?;
        let (a, b) = db::pair(&me, &other);
        c.execute("DELETE FROM friendships WHERE a=? AND b=?", [a, b])?;
        c.execute(
            "DELETE FROM friend_order WHERE (user_id=?1 AND friend_id=?2) OR (user_id=?2 AND friend_id=?1)",
            [a, b],
        )?;
        c.execute("DELETE FROM messages WHERE a=? AND b=?", [a, b])?;
        c.execute("DELETE FROM chat_meta WHERE a=? AND b=?", [a, b])?;
        let both = "(from_id=?1 AND to_id=?2) OR (from_id=?2 AND to_id=?1)";
        let mut q = c.prepare(&format!("SELECT id FROM friend_requests WHERE {both}"))?;
        let reqs = q.query_map([&me, &other], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        c.execute(&format!("DELETE FROM friend_requests WHERE {both}"), [&me, &other])?;
        reqs
    };
    for id in reqs {
        let ev = json!({ "type": "friend_request_canceled", "id": id });
        st.hub.send(&other, &ev);
        st.hub.send(&me, &ev);
    }
    st.hub.send(&other, &json!({ "type": "friendship_deleted", "user_id": me }));
    st.hub.send(&me, &json!({ "type": "friendship_deleted", "user_id": other }));
    Ok(Json(json!({ "ok": true })))
}

async fn unblock_user(State(st): State<S>, Authed(me): Authed, Path(other): Path<String>) -> R<Json<Value>> {
    st.db().execute("DELETE FROM blocks WHERE user_id=? AND blocked_id=?", [&me, &other])?;
    Ok(Json(json!({ "ok": true })))
}

async fn list_blocks(State(st): State<S>, Authed(me): Authed) -> R<Json<Vec<PublicUser>>> {
    let c = st.db();
    let mut q = c.prepare(&format!(
        "SELECT {USER_COLS} FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=? ORDER BY b.created_at DESC"
    ))?;
    let v = q.query_map([&me], |r| row_user(r, 0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct ReportReq {
    user_id: String,
    reason: String,
    message_id: Option<String>,
    group_id: Option<String>,
}

async fn report_user(State(st): State<S>, Authed(me): Authed, Json(r): Json<ReportReq>) -> R<Json<Value>> {
    let reason: String = r.reason.trim().chars().take(500).collect();
    if reason.is_empty() {
        return Err(bad("Pick a reason"));
    }
    let c = st.db();
    let recent: i64 = c.query_row(
        "SELECT COUNT(*) FROM reports WHERE reporter_id=? AND created_at>?",
        params![me, now() - 86_400],
        |r| r.get(0),
    )?;
    if recent >= 20 {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "RateLimited", "Too many reports today"));
    }
    c.query_row("SELECT 1 FROM users WHERE id=?", [&r.user_id], |_| Ok(()))
        .optional()?
        .ok_or_else(|| not_found("No one like that"))?;
    let snapshot: Option<String> = match &r.message_id {
        Some(m) => c
            .query_row("SELECT body FROM messages WHERE id=? AND sender=?", [m, &r.user_id], |r| r.get(0))
            .optional()
            .unwrap_or(None),
        None => None,
    };
    c.execute(
        "INSERT INTO reports(id, reporter_id, target_id, reason, message_id, group_id, snapshot, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
        params![uuid::Uuid::new_v4().to_string(), me, r.user_id, reason, r.message_id, r.group_id, snapshot, now()],
    )?;
    tracing::warn!(target: "reports", "new report against {}", r.user_id);
    Ok(Json(json!({ "ok": true })))
}

// ---------- admin ----------

fn is_banned(c: &Connection, email: &str) -> rusqlite::Result<bool> {
    Ok(c.query_row("SELECT 1 FROM banned_emails WHERE email=?", [email], |_| Ok(())).optional()?.is_some())
}

struct Admin;

fn is_admin(email: &str) -> bool {
    std::env::var("YAP_ADMINS")
        .unwrap_or_else(|_| "info@kreatix.dev".into())
        .split(',')
        .any(|a| a.trim().eq_ignore_ascii_case(email))
}

impl FromRequestParts<S> for Admin {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, st: &S) -> R<Self> {
        let Authed(uid) = Authed::from_request_parts(parts, st).await?;
        let email: String = st.db().query_row("SELECT email FROM users WHERE id=?", [&uid], |r| r.get(0))?;
        if is_admin(&email) {
            Ok(Admin)
        } else {
            Err(err(StatusCode::FORBIDDEN, "Forbidden", "Not an admin"))
        }
    }
}

async fn admin_overview(State(st): State<S>, _: Admin) -> R<Json<Value>> {
    let c = st.db();
    let n = |q: &str, p: i64| -> rusqlite::Result<i64> { c.query_row(q, [p], |r| r.get(0)) };
    let mut q = c.prepare("SELECT id FROM users")?;
    let online = q.query_map([], |r| r.get::<_, String>(0))?.filter_map(Result::ok).filter(|id| st.hub.online(id)).count();
    Ok(Json(json!({
        "users": c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get::<_, i64>(0))?,
        "online": online,
        "new_24h": n("SELECT COUNT(*) FROM users WHERE created_at>?", now() - 86_400)?,
        "messages_24h": n("SELECT COUNT(*) FROM messages WHERE created_at>?", now_ms() - 86_400_000)?,
        "groups": c.query_row("SELECT COUNT(*) FROM groups", [], |r| r.get::<_, i64>(0))?,
        "open_reports": c.query_row("SELECT COUNT(*) FROM reports WHERE status='open'", [], |r| r.get::<_, i64>(0))?,
        "blocks": c.query_row("SELECT COUNT(*) FROM blocks", [], |r| r.get::<_, i64>(0))?,
        "banned": c.query_row("SELECT COUNT(*) FROM banned_emails", [], |r| r.get::<_, i64>(0))?,
    })))
}

#[derive(Deserialize)]
struct ReportsQuery {
    status: Option<String>,
}

fn user_json(r: &Row, o: usize) -> rusqlite::Result<Value> {
    let id: Option<String> = r.get(o)?;
    Ok(match id {
        None => Value::Null,
        Some(id) => json!({ "id": id, "username": r.get::<_, Option<String>>(o + 1)?, "display_name": r.get::<_, String>(o + 2)?, "pfp": r.get::<_, Option<String>>(o + 3)?, "avatar": r.get::<_, Option<String>>(o + 4)?, "email": r.get::<_, String>(o + 5)? }),
    })
}

async fn admin_reports(State(st): State<S>, _: Admin, Query(q): Query<ReportsQuery>) -> R<Json<Vec<Value>>> {
    let status = q.status.unwrap_or_else(|| "open".into());
    let c = st.db();
    let mut s = c.prepare(
        "SELECT r.id, r.reason, r.snapshot, r.message_id, r.group_id, r.status, r.created_at, r.target_id,
                (SELECT COUNT(*) FROM reports x WHERE x.target_id=r.target_id),
                t.id, t.username, t.display_name, t.pfp, t.avatar, t.email,
                p.id, p.username, p.display_name, p.pfp, p.avatar, p.email
         FROM reports r LEFT JOIN users t ON t.id=r.target_id LEFT JOIN users p ON p.id=r.reporter_id
         WHERE r.status=? ORDER BY r.created_at DESC LIMIT 200",
    )?;
    let v = s
        .query_map([&status], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?, "reason": r.get::<_, String>(1)?, "snapshot": r.get::<_, Option<String>>(2)?,
                "message_id": r.get::<_, Option<String>>(3)?, "group_id": r.get::<_, Option<String>>(4)?,
                "status": r.get::<_, String>(5)?, "created_at": r.get::<_, i64>(6)?, "target_id": r.get::<_, String>(7)?,
                "target_reports": r.get::<_, i64>(8)?, "target": user_json(r, 9)?, "reporter": user_json(r, 15)?,
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct ReportStatus {
    status: String,
}

async fn admin_report_status(State(st): State<S>, _: Admin, Path(id): Path<String>, Json(r): Json<ReportStatus>) -> R<Json<Value>> {
    if !matches!(r.status.as_str(), "open" | "dismissed" | "actioned") {
        return Err(bad("Unknown status"));
    }
    st.db().execute("UPDATE reports SET status=? WHERE id=?", [&r.status, &id])?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct BanReq {
    reason: Option<String>,
}

async fn admin_ban(State(st): State<S>, _: Admin, Path(uid): Path<String>, Json(r): Json<BanReq>) -> R<Json<Value>> {
    let email: String = st
        .db()
        .query_row("SELECT email FROM users WHERE id=?", [&uid], |r| r.get(0))
        .optional()?
        .ok_or_else(|| not_found("No such user"))?;
    if is_admin(&email) {
        return Err(err(StatusCode::BAD_REQUEST, "Admin", "Admins can't be banned"));
    }
    {
        let c = st.db();
        c.execute(
            "INSERT OR REPLACE INTO banned_emails(email, reason, created_at) VALUES(?, ?, ?)",
            params![email, r.reason.unwrap_or_default().chars().take(300).collect::<String>(), now()],
        )?;
        c.execute("UPDATE reports SET status='actioned' WHERE target_id=? AND status='open'", [&uid])?;
    }
    delete_account(&st, &uid)?;
    Ok(Json(json!({ "ok": true })))
}

async fn admin_bans(State(st): State<S>, _: Admin) -> R<Json<Vec<Value>>> {
    let c = st.db();
    let mut s = c.prepare("SELECT email, reason, created_at FROM banned_emails ORDER BY created_at DESC LIMIT 500")?;
    let v = s
        .query_map([], |r| Ok(json!({ "email": r.get::<_, String>(0)?, "reason": r.get::<_, String>(1)?, "created_at": r.get::<_, i64>(2)? })))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(v))
}

async fn admin_unban(State(st): State<S>, _: Admin, Path(email): Path<String>) -> R<Json<Value>> {
    st.db().execute("DELETE FROM banned_emails WHERE email=?", [email.to_lowercase()])?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct UserSearch {
    q: Option<String>,
}

async fn admin_users(State(st): State<S>, _: Admin, Query(q): Query<UserSearch>) -> R<Json<Vec<Value>>> {
    let term = format!("%{}%", q.q.unwrap_or_default().trim().trim_start_matches('@').to_lowercase());
    let c = st.db();
    let mut s = c.prepare(
        "SELECT u.id, u.username, u.display_name, u.pfp, u.avatar, u.email, u.created_at,
                (SELECT COUNT(*) FROM reports r WHERE r.target_id=u.id),
                (SELECT COUNT(*) FROM friendships f WHERE f.a=u.id OR f.b=u.id)
         FROM users u WHERE lower(coalesce(u.username,'')) LIKE ?1 OR lower(u.email) LIKE ?1 OR lower(u.display_name) LIKE ?1
         ORDER BY u.created_at DESC LIMIT 100",
    )?;
    let v = s
        .query_map([&term], |r| {
            let mut u = user_json(r, 0)?;
            u["created_at"] = json!(r.get::<_, i64>(6)?);
            u["reports"] = json!(r.get::<_, i64>(7)?);
            u["friends"] = json!(r.get::<_, i64>(8)?);
            u["online"] = json!(st.hub.online(&r.get::<_, String>(0)?));
            Ok(u)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(v))
}

// ---------- devices ----------

#[derive(Deserialize)]
struct DeviceReq {
    token: String,
    platform: Option<String>,
}

async fn add_device(State(st): State<S>, Authed(uid): Authed, Json(r): Json<DeviceReq>) -> R<Json<Value>> {
    if !(r.token.starts_with("ExponentPushToken[") || r.token.starts_with("ExpoPushToken[")) || r.token.len() > 200 {
        return Err(bad("Unsupported push token"));
    }
    let platform = r.platform.unwrap_or_default().chars().take(16).collect::<String>();
    st.db().execute(
        "INSERT INTO devices(token, user_id, platform, updated_at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, platform=excluded.platform, updated_at=excluded.updated_at",
        params![r.token, uid, platform, now()],
    )?;
    Ok(Json(json!({ "ok": true })))
}

async fn remove_device(State(st): State<S>, Authed(uid): Authed, Json(r): Json<DeviceReq>) -> R<Json<Value>> {
    st.db().execute("DELETE FROM devices WHERE token=? AND user_id=?", [&r.token, &uid])?;
    Ok(Json(json!({ "ok": true })))
}

// ---------- realtime voice ----------
// Each user owns an inbox room `u_<id>` they listen to. Talking to a friend means
// publishing your microphone into the friend's inbox room.

async fn rtc_listen(State(st): State<S>, Authed(uid): Authed) -> R<Json<Value>> {
    let u = public_user(&st.db(), &uid)?;
    let room = format!("u_{uid}");
    let token = st.lk_token(&uid, &label(&u), &room, false, 6 * 3600);
    Ok(Json(json!({ "url": st.cfg.lk_url, "room": room, "token": token })))
}

#[derive(Deserialize)]
struct FriendReq {
    friend_id: String,
}

async fn rtc_focus(State(st): State<S>, Authed(me): Authed, Json(r): Json<FriendReq>) -> R<Json<Value>> {
    let u = {
        let c = st.db();
        if !are_friends(&c, &me, &r.friend_id)? {
            return Err(not_friends());
        }
        public_user(&c, &me)?
    };
    let room = format!("u_{}", r.friend_id);
    let token = st.lk_token(&me, &label(&u), &room, true, 3600);
    Ok(Json(json!({ "url": st.cfg.lk_url, "room": room, "token": token })))
}

async fn ptt_start(State(st): State<S>, Authed(me): Authed, Json(r): Json<FriendReq>) -> R<Json<Value>> {
    let (u, dnd, streak) = {
        let c = st.db();
        if !are_friends(&c, &me, &r.friend_id)? {
            return Err(not_friends());
        }
        let dnd: i64 = c.query_row("SELECT dnd FROM users WHERE id=?", [&r.friend_id], |r| r.get(0))?;
        let u = public_user(&c, &me)?;
        let streak = if dnd == 0 { Some(touch_streak(&c, &me, &r.friend_id)?) } else { None };
        (u, dnd != 0, streak)
    };
    if dnd {
        return Err(err(StatusCode::CONFLICT, "FriendUnavailable", "They're on do not disturb"));
    }
    if let Some((current, last_talked_at)) = streak {
        broadcast_streak(&st, &me, &r.friend_id, current, last_talked_at);
    }
    recorder(&st, "/start", json!({ "from": me, "to": r.friend_id }));
    bump(&st, &me, "talks", 1);
    let online = st.hub.online(&r.friend_id);
    st.hub.send(&r.friend_id, &json!({ "type": "ptt_started", "from": &u }));
    if !online {
        push(&st, &r.friend_id, label(&u), "is talking to you".into(), json!({ "type": "ptt", "from": u.id }));
    }
    Ok(Json(json!({ "ok": true, "delivered_live": online })))
}

async fn ptt_stop(State(st): State<S>, Authed(me): Authed, Json(r): Json<FriendReq>) -> R<Json<Value>> {
    if !are_friends(&st.db(), &me, &r.friend_id)? {
        return Err(not_friends());
    }
    st.hub.send(&r.friend_id, &json!({ "type": "ptt_stopped", "from_id": me }));
    recorder(&st, "/stop", json!({ "from": me, "to": r.friend_id }));
    Ok(Json(json!({ "ok": true })))
}

/// (id, stat, title, description, goal)
const TROPHIES: &[(&str, &str, &str, &str, i64)] = &[
    ("first_words", "talks", "first words", "talk to a friend", 1),
    ("yapper", "talks", "yapper", "talk 100 times", 100),
    ("cant_stop", "talks", "can't stop yapping", "talk 1,000 times", 1000),
    ("on_the_line", "calls", "on the line", "have your first call", 1),
    ("phone_friend", "calls", "phone friend", "have 25 calls", 25),
    ("poke_master", "pokes", "poke master", "poke 500 times", 500),
    ("squad_up", "group_talks", "squad up", "talk to a group", 1),
    ("the_crew", "friends", "the crew", "have 5 friends", 5),
    ("on_fire", "streak", "on fire", "3 day streak with someone", 3),
    ("week_strong", "streak", "week strong", "7 day streak with someone", 7),
    ("unstoppable", "streak", "unstoppable", "30 day streak with someone", 30),
];

/// Counts an action and tells the user the moment it unlocks a trophy.
fn bump(st: &S, uid: &str, col: &'static str, by: i64) {
    let after: i64 = {
        let c = st.db();
        let up = format!("INSERT INTO stats(user_id, {col}) VALUES (?1, ?2) ON CONFLICT(user_id) DO UPDATE SET {col}={col}+?2");
        if c.execute(&up, params![uid, by]).is_err() { return; }
        c.query_row(&format!("SELECT {col} FROM stats WHERE user_id=?"), [uid], |r| r.get(0)).unwrap_or(0)
    };
    let before = after - by;
    for t in TROPHIES.iter().filter(|t| t.1 == col && before < t.4 && after >= t.4) {
        st.hub.send(uid, &json!({ "type": "achievement", "id": t.0, "title": t.2 }));
    }
}

async fn achievements(State(st): State<S>, Authed(me): Authed) -> R<Json<Value>> {
    let c = st.db();
    let (talks, calls, pokes, group_talks): (i64, i64, i64, i64) = c
        .query_row("SELECT talks, calls, pokes, group_talks FROM stats WHERE user_id=?", [&me], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()?
        .unwrap_or_default();
    let friends = friend_ids(&c, &me)?.len() as i64;
    let streak: i64 = c.query_row("SELECT COALESCE(MAX(longest), 0) FROM streaks WHERE a=?1 OR b=?1", [&me], |r| r.get(0))?;
    let list: Vec<Value> = TROPHIES
        .iter()
        .map(|t| {
            let have = match t.1 { "talks" => talks, "calls" => calls, "pokes" => pokes, "group_talks" => group_talks, "friends" => friends, _ => streak };
            json!({ "id": t.0, "title": t.2, "sub": t.3, "goal": t.4, "progress": have.min(t.4), "done": have >= t.4 })
        })
        .collect();
    Ok(Json(json!(list)))
}

const CLIP_TTL_MS: i64 = 7 * 24 * 3600 * 1000;

/// Fire-and-forget call to the local talk recorder (bot/recorder.js).
fn recorder(st: &S, path: &'static str, body: Value) {
    let Some(secret) = st.cfg.rec_secret.clone() else { return };
    let st = st.clone();
    tokio::spawn(async move {
        let url = format!("{}{path}", st.cfg.rec_url);
        if let Err(e) = st.http.post(url).header("x-recorder-secret", secret).json(&body).send().await {
            tracing::warn!(error = %e, path, "recorder call failed");
        }
    });
}

#[derive(Deserialize)]
struct ClipIn {
    id: String,
    from: String,
    to: String,
    ms: i64,
}

/// The recorder reports a finished talk; it stays until the receiver plays it, marks it heard, or it expires.
async fn internal_clip(State(st): State<S>, headers: HeaderMap, Json(r): Json<ClipIn>) -> R<Json<Value>> {
    let ok = st.cfg.rec_secret.as_deref().is_some_and(|s| headers.get("x-recorder-secret").and_then(|v| v.to_str().ok()) == Some(s));
    if !ok {
        return Err(err(StatusCode::UNAUTHORIZED, "Unauthorized", "Bad recorder secret"));
    }
    let at = now_ms();
    {
        let c = st.db();
        if !are_friends(&c, &r.from, &r.to)? {
            return Err(not_friends());
        }
        c.execute("DELETE FROM clips WHERE created_at < ?", [at - CLIP_TTL_MS])?;
        c.execute("INSERT OR IGNORE INTO clips(id, from_id, to_id, ms, created_at) VALUES(?,?,?,?,?)", params![r.id, r.from, r.to, r.ms, at])?;
    }
    st.hub.send(&r.to, &json!({ "type": "talk_clip", "clip": { "id": r.id, "from": r.from, "ms": r.ms, "created_at": at } }));
    Ok(Json(json!({ "ok": true })))
}

async fn list_clips(State(st): State<S>, Authed(me): Authed) -> R<Json<Value>> {
    let (rows, gone) = {
        let c = st.db();
        let mut s = c.prepare("SELECT id, from_id, ms, created_at FROM clips WHERE to_id=? ORDER BY created_at")?;
        let all: Vec<(String, String, i64, i64)> = s.query_map([&me], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<_, _>>()?;
        let cutoff = now_ms() - CLIP_TTL_MS;
        let (mut keep, mut gone) = (vec![], vec![]);
        for (id, from, ms, at) in all {
            if at < cutoff || !are_friends(&c, &me, &from)? {
                c.execute("DELETE FROM clips WHERE id=?", [&id])?;
                gone.push(id);
            } else {
                keep.push(json!({ "id": id, "from": from, "ms": ms, "created_at": at }));
            }
        }
        (keep, gone)
    };
    if !gone.is_empty() {
        recorder(&st, "/delete", json!({ "ids": gone }));
    }
    Ok(Json(json!(rows)))
}

fn take_clip(st: &S, me: &str, id: &str) -> R<(String, PublicUser)> {
    let c = st.db();
    let from: Option<String> = c.query_row("SELECT from_id FROM clips WHERE id=? AND to_id=?", [id, me], |r| r.get(0)).optional()?;
    let Some(from) = from else {
        return Err(err(StatusCode::NOT_FOUND, "NotFound", "That talk is gone"));
    };
    c.execute("DELETE FROM clips WHERE id=?", [id])?;
    let u = public_user(&c, &from)?;
    Ok((from, u))
}

/// Replays a saved talk into my inbox room, then deletes it.
async fn play_clip(State(st): State<S>, Authed(me): Authed, Path(id): Path<String>) -> R<Json<Value>> {
    let (from, u) = take_clip(&st, &me, &id)?;
    recorder(&st, "/play", json!({ "id": id, "from": from, "to": me, "name": label(&u) }));
    Ok(Json(json!({ "ok": true })))
}

/// I already heard it live; drop it.
async fn seen_clip(State(st): State<S>, Authed(me): Authed, Path(id): Path<String>) -> R<Json<Value>> {
    if take_clip(&st, &me, &id).is_ok() {
        recorder(&st, "/delete", json!({ "ids": [id] }));
    }
    Ok(Json(json!({ "ok": true })))
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// `yap.kreatix.dev/@username`: invite page that opens the app on "add friend".
async fn invite_page(State(st): State<S>, Path(seg): Path<String>) -> Response {
    let Some(name) = seg.strip_prefix('@').map(|s| s.to_lowercase()) else { return StatusCode::NOT_FOUND.into_response() };
    let u = {
        let c = st.db();
        let id: Option<String> = c.query_row("SELECT id FROM users WHERE username=?", [&name], |r| r.get(0)).optional().ok().flatten();
        id.and_then(|id| public_user(&c, &id).ok())
    };
    let Some(u) = u else { return StatusCode::NOT_FOUND.into_response() };
    let shown = if u.display_name.is_empty() { name.clone() } else { u.display_name.clone() };
    let pic = u.pfp.clone().or(u.avatar.clone()).map(|k| {
        let cdn = k.len() > 2 && matches!(k.as_bytes()[0], b'p' | b'q' | b'b' | b'c') && k.as_bytes()[1] == b'-';
        let url = if cdn { format!("https://cdn.kreatix.dev/{k}") } else { format!("/avatars/{k}") };
        format!("<img src=\"{}\" alt=\"\">", esc(&url))
    }).unwrap_or_else(|| {
        let l: String = shown.chars().next().map(|c| c.to_uppercase().collect()).unwrap_or_default();
        format!("<span>{}</span>", esc(&l))
    });
    let (n, h) = (esc(&shown), esc(&name));
    let page = format!(r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Add {n} on Yapp</title><meta property="og:title" content="Add {n} on Yapp"><meta property="og:description" content="@{h} wants to talk to you on Yapp">
<meta name="theme-color" content="#000"><style>
*{{margin:0;box-sizing:border-box}}html,body{{height:100%;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}}
main{{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;text-align:center}}
.p{{width:132px;height:132px;border-radius:50%;overflow:hidden;background:#1c1c1e;display:flex;align-items:center;justify-content:center;font-size:56px;font-weight:900;margin-bottom:6px}}
.p img{{width:100%;height:100%;object-fit:cover}}h1{{font-size:34px;font-weight:900;letter-spacing:-.5px}}p{{color:rgba(255,255,255,.55);font-size:17px}}
a{{margin-top:22px;display:block;width:100%;max-width:320px;height:56px;line-height:56px;border-radius:28px;background:#fff;color:#000;font-weight:900;font-size:18px;text-decoration:none;transition:transform .15s}}
a:active{{transform:scale(.97)}}
</style></head><body><main><div class="p">{pic}</div><h1>{n}</h1><p>@{h}</p><a href="yapp://add?u={h}">add on yapp</a></main></body></html>"##);
    ([(header::CACHE_CONTROL, "no-store")], Html(page)).into_response()
}

#[derive(Deserialize)]
struct PokeReq {
    friend_id: String,
    #[serde(default)]
    count: Option<u32>,
}

async fn poke(State(st): State<S>, Authed(me): Authed, Json(r): Json<PokeReq>) -> R<Json<Value>> {
    let key = (me.clone(), r.friend_id.clone());
    if st.pokes.get(&key).is_some_and(|t| t.elapsed() < Duration::from_millis(800)) {
        return Err(too_many("Easy"));
    }
    let u = {
        let c = st.db();
        if !are_friends(&c, &me, &r.friend_id)? {
            return Err(not_friends());
        }
        public_user(&c, &me)?
    };
    st.pokes.insert(key, Instant::now());
    if st.pokes.len() > 10_000 {
        st.pokes.retain(|_, t| t.elapsed() < Duration::from_secs(10));
    }
    let online = st.hub.online(&r.friend_id);
    let count = r.count.unwrap_or(1).clamp(1, 9999);
    bump(&st, &me, "pokes", count as i64);
    st.hub.send(&r.friend_id, &json!({ "type": "poke", "from": &u, "count": count }));
    if !online {
        let body = if count > 1 { format!("poked you {count} times") } else { "poked you".into() };
        push(&st, &r.friend_id, label(&u), body, json!({ "type": "poke", "from": u.id }));
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct WaveReq {
    friend_id: String,
    #[serde(default)]
    count: Option<u32>,
    /// Set to true only on the first wave of a burst or manual single tap
    #[serde(default)]
    notify: Option<bool>,
}

async fn wave(State(st): State<S>, Authed(me): Authed, Json(r): Json<WaveReq>) -> R<Json<Value>> {
    let u = {
        let c = st.db();
        if !are_friends(&c, &me, &r.friend_id)? {
            return Err(not_friends());
        }
        public_user(&c, &me)?
    };
    let count = r.count.unwrap_or(1).clamp(1, 9999);
    let should_notify = r.notify.unwrap_or(true);
    let key = (me.clone(), r.friend_id.clone());

    // Send realtime event for live wave animation & counter
    st.hub.send(&r.friend_id, &json!({ "type": "wave", "from": &u, "count": count }));

    // Only push if notify is true AND not throttled within 10s window to avoid notification spamming
    if should_notify {
        let throttled = st.waves.get(&key).is_some_and(|t| t.elapsed() < Duration::from_secs(10));
        if !throttled {
            st.waves.insert(key, Instant::now());
            if st.waves.len() > 10_000 {
                st.waves.retain(|_, t| t.elapsed() < Duration::from_secs(30));
            }
            let online = st.hub.online(&r.friend_id);
            if !online {
                push(&st, &r.friend_id, label(&u), "waved at you 👋".into(), json!({ "type": "wave", "from": u.id }));
            }
        }
    }

    Ok(Json(json!({ "ok": true })))
}

async fn call_start(State(st): State<S>, Authed(me): Authed, Json(r): Json<FriendReq>) -> R<Json<Value>> {
    let (u, dnd) = {
        let c = st.db();
        if !are_friends(&c, &me, &r.friend_id)? {
            return Err(not_friends());
        }
        let dnd: i64 = c.query_row("SELECT dnd FROM users WHERE id=?", [&r.friend_id], |r| r.get(0))?;
        (public_user(&c, &me)?, dnd != 0)
    };
    if dnd {
        return Err(err(StatusCode::CONFLICT, "FriendUnavailable", "They're on do not disturb"));
    }
    let online = st.hub.online(&r.friend_id);
    st.hub.send(&r.friend_id, &json!({ "type": "call_ringing", "from": &u }));
    if !online {
        push(&st, &r.friend_id, label(&u), "is calling you".into(), json!({ "type": "call", "from": u.id }));
    }
    Ok(Json(json!({ "ok": true, "delivered_live": online })))
}

async fn call_signal(st: &S, me: &str, friend: &str, kind: &str) -> R<Json<Value>> {
    if !are_friends(&st.db(), me, friend)? {
        return Err(not_friends());
    }
    st.hub.send(friend, &json!({ "type": kind, "from_id": me }));
    Ok(Json(json!({ "ok": true })))
}

async fn call_accept(State(st): State<S>, Authed(me): Authed, Json(r): Json<FriendReq>) -> R<Json<Value>> {
    let (streak, last_talked_at) = {
        let c = st.db();
        if !are_friends(&c, &me, &r.friend_id)? {
            return Err(not_friends());
        }
        touch_streak(&c, &me, &r.friend_id)?
    };
    st.hub.send(&r.friend_id, &json!({ "type": "call_accepted", "from_id": me }));
    bump(&st, &me, "calls", 1);
    bump(&st, &r.friend_id, "calls", 1);
    broadcast_streak(&st, &me, &r.friend_id, streak, last_talked_at);
    Ok(Json(json!({ "ok": true })))
}

async fn call_end(State(st): State<S>, Authed(me): Authed, Json(r): Json<FriendReq>) -> R<Json<Value>> {
    call_signal(&st, &me, &r.friend_id, "call_ended").await
}

// ---------- chats ----------

#[derive(Serialize)]
struct ChatMsg {
    id: String,
    from: String,
    to: String,
    kind: String,
    body: String,
    created_at: i64,
    /// Photos: "w,h,thumb" (thumb = tiny base64 WebP for the instant blurred preview).
    #[serde(skip_serializing_if = "Option::is_none")]
    meta: Option<String>,
}

const MSG_COLS: &str = "id, sender, recipient, kind, body, created_at, (SELECT w || ',' || h || ',' || thumb FROM media_meta WHERE key=messages.body AND messages.kind='image')";

fn row_msg(r: &Row) -> rusqlite::Result<ChatMsg> {
    Ok(ChatMsg { id: r.get(0)?, from: r.get(1)?, to: r.get(2)?, kind: r.get(3)?, body: r.get(4)?, created_at: r.get(5)?, meta: r.get(6)? })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn touch_streak(c: &Connection, me: &str, other: &str) -> R<(i64, i64)> {
    touch_streak_at(c, me, other, now_ms())
}

fn touch_streak_at(c: &Connection, me: &str, other: &str, now: i64) -> R<(i64, i64)> {
    const DAY_MS: i64 = 86_400_000;
    let today = now / DAY_MS;
    let (a, b) = db::pair(me, other);
    let tx = c.unchecked_transaction()?;
    tx.execute("INSERT OR IGNORE INTO streaks(a, b) VALUES (?1, ?2)", params![a, b])?;
    let side = if me == a { "a_day" } else { "b_day" };
    tx.execute(
        &format!("UPDATE streaks SET {side}=?3, last_talked=?4 WHERE a=?1 AND b=?2"),
        params![a, b, today, now],
    )?;
    let (a_day, b_day, mut day, mut current, mut longest): (i64, i64, i64, i64, i64) =
        tx.query_row("SELECT a_day, b_day, day, current, longest FROM streaks WHERE a=?1 AND b=?2", params![a, b], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?;
    if a_day == today && b_day == today && day != today {
        current = if day == today - 1 { current + 1 } else { 1 };
        day = today;
        longest = longest.max(current);
    }
    tx.execute("UPDATE streaks SET day=?3, current=?4, longest=?5 WHERE a=?1 AND b=?2", params![a, b, day, current, longest])?;
    tx.commit()?;
    Ok((if day >= today - 1 { current } else { 0 }, now))
}

fn read_at(c: &Connection, user: &str, friend: &str) -> rusqlite::Result<i64> {
    Ok(c.query_row("SELECT read_at FROM chat_reads WHERE user_id=? AND friend_id=?", [user, friend], |r| r.get(0)).optional()?.unwrap_or(0))
}

fn chat_background(c: &Connection, a: &str, b: &str) -> rusqlite::Result<Option<String>> {
    Ok(c.query_row("SELECT background FROM chat_meta WHERE a=? AND b=?", [a, b], |r| r.get(0)).optional()?.flatten())
}

/// When `user` last deleted their copy of the chat with `friend` (0 = never).
fn cleared_at(c: &Connection, user: &str, friend: &str) -> rusqlite::Result<i64> {
    Ok(c.query_row("SELECT at FROM chat_clears WHERE user_id=? AND friend_id=?", [user, friend], |r| r.get(0)).optional()?.unwrap_or(0))
}

async fn list_chats(State(st): State<S>, Authed(me): Authed) -> R<Json<Value>> {
    let c = st.db();
    let mut out = Vec::new();
    for f in friend_ids(&c, &me)? {
        let (a, b) = db::pair(&me, &f);
        let gone = cleared_at(&c, &me, &f)?;
        let last = c
            .query_row(&format!("SELECT {MSG_COLS} FROM messages WHERE a=?1 AND b=?2 AND created_at>?3 ORDER BY created_at DESC LIMIT 1"), params![a, b, gone], row_msg)
            .optional()?;
        let mine = read_at(&c, &me, &f)?.max(gone);
        let unread: i64 = c.query_row(
            "SELECT COUNT(*) FROM messages WHERE a=?1 AND b=?2 AND recipient=?3 AND created_at>?4",
            params![a, b, me, mine],
            |r| r.get(0),
        )?;
        out.push(json!({ "friend_id": f, "last": last, "unread": unread, "background": chat_background(&c, a, b)? }));
    }
    Ok(Json(json!({ "chats": out })))
}

#[derive(Deserialize)]
struct Page {
    before: Option<i64>,
    limit: Option<i64>,
}

async fn list_messages(State(st): State<S>, Authed(me): Authed, Path(other): Path<String>, axum::extract::Query(p): axum::extract::Query<Page>) -> R<Json<Value>> {
    let c = st.db();
    if !are_friends(&c, &me, &other)? {
        return Err(not_friends());
    }
    let (a, b) = db::pair(&me, &other);
    let gone = cleared_at(&c, &me, &other)?;
    let mut q = c.prepare(&format!("SELECT {MSG_COLS} FROM messages WHERE a=?1 AND b=?2 AND created_at<?3 AND created_at>?5 ORDER BY created_at DESC LIMIT ?4"))?;
    let msgs: Vec<ChatMsg> = q
        .query_map(params![a, b, p.before.unwrap_or(i64::MAX), p.limit.unwrap_or(50).clamp(1, 100), gone], row_msg)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Json(json!({ "messages": msgs, "background": chat_background(&c, a, b)?, "their_read_at": read_at(&c, &other, &me)? })))
}

/// Deletes my copy of the chat. Whatever both sides have deleted is wiped for real, photos included.
async fn delete_chat(State(st): State<S>, Authed(me): Authed, Path(other): Path<String>) -> R<Json<Value>> {
    let photos = {
        let c = st.db();
        let (a, b) = db::pair(&me, &other);
        let top: i64 = c.query_row("SELECT COALESCE(MAX(created_at), 0) FROM messages WHERE a=? AND b=?", [a, b], |r| r.get(0))?;
        let at = top.max(now_ms());
        c.execute("INSERT INTO chat_clears(user_id, friend_id, at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, friend_id) DO UPDATE SET at=excluded.at", params![me, other, at])?;
        let both = at.min(cleared_at(&c, &other, &me)?);
        let mut q = c.prepare("SELECT body FROM messages WHERE a=?1 AND b=?2 AND kind='image' AND created_at<=?3")?;
        let photos: Vec<String> = q.query_map(params![a, b, both], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        drop(q);
        c.execute("DELETE FROM messages WHERE a=?1 AND b=?2 AND created_at<=?3", params![a, b, both])?;
        photos
    };
    for k in photos { drop_media(&st, k).await; }
    st.hub.send(&me, &json!({ "type": "chat_cleared", "friend_id": other }));
    Ok(Json(json!({ "ok": true })))
}

/// Unsend: removes one of my own messages for both of us (and its photo once nothing else uses it).
async fn delete_dm_message(State(st): State<S>, Authed(me): Authed, Path((other, mid)): Path<(String, String)>) -> R<Json<Value>> {
    let photo = {
        let c = st.db();
        let (a, b) = db::pair(&me, &other);
        let row: Option<(String, String, String)> = c
            .query_row("SELECT sender, kind, body FROM messages WHERE id=?1 AND a=?2 AND b=?3", params![mid, a, b], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()?;
        let Some((sender, kind, body)) = row else { return Err(not_found("Message not found")) };
        if sender != me { return Err(err(StatusCode::FORBIDDEN, "Forbidden", "You can only delete your own messages")); }
        c.execute("DELETE FROM messages WHERE id=?", [&mid])?;
        (kind == "image").then_some(body)
    };
    if let Some(k) = photo { drop_media(&st, k).await; }
    st.hub.send(&other, &json!({ "type": "message_deleted", "friend_id": me, "id": mid }));
    st.hub.send(&me, &json!({ "type": "message_deleted", "friend_id": other, "id": mid }));
    Ok(Json(json!({ "ok": true })))
}

async fn delete_group_message(State(st): State<S>, Authed(me): Authed, Path((g, mid)): Path<(String, String)>) -> R<Json<Value>> {
    let (photo, ids) = {
        let c = st.db();
        if !is_member(&c, &g, &me)? { return Err(not_found("Group not found")); }
        let row: Option<(String, String, String)> = c
            .query_row("SELECT sender, kind, body FROM messages WHERE id=?1 AND a=?2 AND b='#'", params![mid, g], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()?;
        let Some((sender, kind, body)) = row else { return Err(not_found("Message not found")) };
        if sender != me { return Err(err(StatusCode::FORBIDDEN, "Forbidden", "You can only delete your own messages")); }
        c.execute("DELETE FROM messages WHERE id=?", [&mid])?;
        ((kind == "image").then_some(body), member_ids(&c, &g)?)
    };
    if let Some(k) = photo { drop_media(&st, k).await; }
    tell_group(&st, &ids, &json!({ "type": "group_message_deleted", "group_id": g, "id": mid }));
    Ok(Json(json!({ "ok": true })))
}

async fn chat_photos(State(st): State<S>, Authed(me): Authed, Path(other): Path<String>) -> R<Json<Vec<ChatMsg>>> {
    let c = st.db();
    if !are_friends(&c, &me, &other)? { return Err(not_friends()); }
    let (a, b) = db::pair(&me, &other);
    let gone = cleared_at(&c, &me, &other)?;
    let mut q = c.prepare(&format!("SELECT {MSG_COLS} FROM messages WHERE a=?1 AND b=?2 AND kind='image' AND created_at>?3 ORDER BY created_at DESC LIMIT 300"))?;
    let v = q.query_map(params![a, b, gone], row_msg)?.collect::<rusqlite::Result<_>>()?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct SendMsg {
    body: String,
    kind: Option<String>,
    meta: Option<String>,
}

async fn send_message(State(st): State<S>, Authed(me): Authed, Path(other): Path<String>, Json(r): Json<SendMsg>) -> R<Json<ChatMsg>> {
    let body = r.body.trim().to_string();
    if body.is_empty() {
        return Err(bad("Say something"));
    }
    if body.chars().count() > 2000 {
        return Err(bad("That message is too long"));
    }
    let kind = r.kind.unwrap_or_else(|| "text".into());
    if kind != "text" && kind != "sticker" {
        return Err(bad("Unknown message kind"));
    }
    if kind == "sticker" && !sticker_exists(&st, &body) {
        return Err(not_found("Sticker not found"));
    }
    post_dm(&st, me, other, &kind, body, r.meta).await
}

#[derive(Deserialize)]
struct PhotoMeta {
    w: u32,
    h: u32,
    #[serde(default)]
    t: String,
}

/// Stores a chat photo once (content-addressed `c-` key on B2/CDN) plus its size and blur preview.
async fn save_chat_photo(st: &S, body: &[u8], p: &PhotoMeta) -> R<(String, String)> {
    let Some((ext, ctype)) = crate::storage::image_kind(body).filter(|_| body.len() >= 100) else {
        return Err(bad("Upload a JPEG or WebP photo"));
    };
    if p.w == 0 || p.h == 0 || p.w > 4096 || p.h > 4096 { return Err(bad("Bad photo size")); }
    let thumb: String = p.t.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=')).take(3000).collect();
    let store = crate::storage::get().ok_or_else(|| bad("Photos aren't available right now"))?;
    let key = crate::storage::key_for("c", body, ext);
    let known = st.db().query_row("SELECT 1 FROM media_meta WHERE key=?", [&key], |_| Ok(())).optional()?.is_some();
    if !known {
        store.put(&key, body.to_vec(), ctype).await.map_err(|e| { tracing::error!(error = %e, "b2 put"); bad("Couldn't save photo") })?;
        st.db().execute("INSERT OR IGNORE INTO media_meta(key, w, h, thumb) VALUES (?,?,?,?)", params![key, p.w, p.h, thumb])?;
    }
    let meta = format!("{},{},{}", p.w, p.h, thumb);
    Ok((key, meta))
}

async fn send_photo(State(st): State<S>, Authed(me): Authed, Path(other): Path<String>, Query(p): Query<PhotoMeta>, body: axum::body::Bytes) -> R<Json<ChatMsg>> {
    if !are_friends(&st.db(), &me, &other)? { return Err(not_friends()); }
    let (key, meta) = save_chat_photo(&st, &body, &p).await?;
    post_dm(&st, me, other, "image", key, Some(meta)).await
}

fn sticker_exists(st: &S, id: &str) -> bool {
    st.db()
        .query_row("SELECT 1 FROM stickers WHERE id=?", [id], |_| Ok(()))
        .optional()
        .ok()
        .flatten()
        .is_some()
}

async fn post_dm(st: &S, me: String, other: String, kind: &str, body: String, meta: Option<String>) -> R<Json<ChatMsg>> {
    let meta = meta.or_else(|| {
        if kind == "sticker" {
            st.db().query_row(
                "SELECT width, height, name FROM stickers WHERE id=?",
                [&body],
                |r| {
                    let w: u32 = r.get(0)?;
                    let h: u32 = r.get(1)?;
                    let name: Option<String> = r.get(2)?;
                    Ok(format!("{}:{}:{}", w, h, name.unwrap_or_default()))
                },
            ).ok()
        } else {
            None
        }
    });
    let (m, u) = {
        let c = st.db();
        if !are_friends(&c, &me, &other)? {
            return Err(not_friends());
        }
        let (a, b) = db::pair(&me, &other);
        let mut t = now_ms();
        let last: Option<i64> = c.query_row("SELECT MAX(created_at) FROM messages WHERE a=? AND b=?", [a, b], |r| r.get(0))?;
        if let Some(l) = last {
            t = t.max(l + 1);
        }
        let m = ChatMsg { id: random_token()[..16].to_string(), from: me.clone(), to: other.clone(), kind: kind.into(), body, created_at: t, meta: meta.clone() };
        c.execute(
            "INSERT INTO messages(id, a, b, sender, recipient, kind, body, created_at) VALUES (?,?,?,?,?,?,?,?)",
            params![m.id, a, b, m.from, m.to, m.kind, m.body, m.created_at],
        )?;
        c.execute(
            "INSERT INTO chat_reads(user_id, friend_id, read_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, friend_id) DO UPDATE SET read_at=excluded.read_at",
            params![me, other, t],
        )?;
        (m, public_user(&c, &me)?)
    };
    let ev = json!({ "type": "message", "message": &m });
    let online = st.hub.online(&other);
    st.hub.send(&other, &ev);
    st.hub.send(&me, &ev);
    if !online {
        let preview: String = if m.kind == "image" { "sent a photo".into() } else { m.body.chars().take(120).collect() };
        push(st, &other, label(&u), preview, json!({ "type": "message", "from": me }));
    }
    Ok(Json(m))
}

#[derive(Deserialize)]
struct ReadReq {
    at: i64,
}

async fn mark_read(State(st): State<S>, Authed(me): Authed, Path(other): Path<String>, Json(r): Json<ReadReq>) -> R<Json<Value>> {
    let at = r.at.min(now_ms() + 60_000);
    {
        let c = st.db();
        if !are_friends(&c, &me, &other)? {
            return Err(not_friends());
        }
        c.execute(
            "INSERT INTO chat_reads(user_id, friend_id, read_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, friend_id) DO UPDATE SET read_at=MAX(read_at, excluded.read_at)",
            params![me, other, at],
        )?;
    }
    st.hub.send(&other, &json!({ "type": "chat_read", "user_id": me, "at": at }));
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct BgReq {
    background: Option<String>,
}

async fn put_chat_background_photo(State(st): State<S>, Authed(me): Authed, Path(other): Path<String>, body: axum::body::Bytes) -> R<Json<Value>> {
    let Some((ext, ctype)) = crate::storage::image_kind(&body).filter(|_| body.len() >= 100) else {
        return Err(bad("Upload a JPEG or WebP photo"));
    };
    let store = crate::storage::get().ok_or_else(|| bad("Photo backgrounds aren't available"))?;
    if !are_friends(&st.db(), &me, &other)? {
        return Err(not_friends());
    }
    let key = crate::storage::key_for("b", &body, ext);
    store.put(&key, body.to_vec(), ctype).await.map_err(|e| { tracing::error!(error = %e, "b2 put"); bad("Couldn't save photo") })?;
    apply_background(&st, &me, &other, Some(key)).await
}

async fn apply_background(st: &S, me: &str, other: &str, bg: Option<String>) -> R<Json<Value>> {
    let old = {
        let c = st.db();
        let (a, b) = db::pair(me, other);
        let old = chat_background(&c, a, b)?;
        c.execute(
            "INSERT INTO chat_meta(a, b, background) VALUES (?1, ?2, ?3) ON CONFLICT(a, b) DO UPDATE SET background=excluded.background",
            params![a, b, bg],
        )?;
        old
    };
    if let Some(o) = old.filter(|o| Some(o) != bg.as_ref()) {
        drop_media(st, o).await;
    }
    let ev = json!({ "type": "chat_background", "user_id": me, "friend_id": other, "background": bg });
    st.hub.send(other, &ev);
    st.hub.send(me, &ev);
    Ok(Json(json!({ "ok": true, "background": bg })))
}

async fn set_chat_background(State(st): State<S>, Authed(me): Authed, Path(other): Path<String>, Json(r): Json<BgReq>) -> R<Json<Value>> {
    let bg = r.background.filter(|b| !b.is_empty());
    if let Some(b) = &bg {
        if b.len() > 64 || !b.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
            return Err(bad("Unknown background"));
        }
    }
    if bg.as_deref().is_some_and(|b| b.starts_with("b-")) {
        return Err(bad("Unknown background"));
    }
    if !are_friends(&st.db(), &me, &other)? {
        return Err(not_friends());
    }
    apply_background(&st, &me, &other, bg).await
}

// ---------- group chats ----------

fn member_ids(c: &Connection, g: &str) -> rusqlite::Result<Vec<String>> {
    let mut q = c.prepare("SELECT user_id FROM group_members WHERE group_id=? ORDER BY joined_at")?;
    let v = q.query_map([g], |r| r.get(0))?.collect();
    v
}

fn is_member(c: &Connection, g: &str, u: &str) -> rusqlite::Result<bool> {
    Ok(c.query_row("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?", [g, u], |_| Ok(())).optional()?.is_some())
}

fn group_view(c: &Connection, g: &str, viewer: &str) -> R<Value> {
    let (name, owner, background): (String, String, Option<String>) = c
        .query_row("SELECT name, owner, background FROM groups WHERE id=?", [g], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?
        .ok_or_else(|| not_found("Group not found"))?;
    let mut members = Vec::new();
    let mut reads = serde_json::Map::new();
    let mut q = c.prepare("SELECT user_id, read_at FROM group_members WHERE group_id=? ORDER BY joined_at")?;
    let rows: Vec<(String, i64)> = q.query_map([g], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut mine = 0;
    for (u, at) in rows {
        if u == viewer { mine = at; }
        reads.insert(u.clone(), json!(at));
        members.push(public_user(c, &u)?);
    }
    let last = c.query_row(&format!("SELECT {MSG_COLS} FROM messages WHERE a=? AND b='#' ORDER BY created_at DESC LIMIT 1"), [g], row_msg).optional()?;
    let unread: i64 = c.query_row("SELECT COUNT(*) FROM messages WHERE a=?1 AND b='#' AND sender<>?2 AND created_at>?3", params![g, viewer, mine], |r| r.get(0))?;
    let mut q = c.prepare("SELECT user_id FROM group_invites WHERE group_id=? ORDER BY created_at")?;
    let invited: Vec<String> = q.query_map([g], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(json!({ "id": g, "name": name, "owner": owner, "background": background, "members": members, "invited": invited, "reads": reads, "last": last, "unread": unread }))
}

fn invite_view(c: &Connection, g: &str, u: &str) -> R<Option<Value>> {
    let row: Option<(String, String, i64)> = c
        .query_row("SELECT gr.name, i.from_id, i.created_at FROM group_invites i JOIN groups gr ON gr.id=i.group_id WHERE i.group_id=? AND i.user_id=?", [g, u], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?;
    let Some((name, from, at)) = row else { return Ok(None) };
    let n: i64 = c.query_row("SELECT COUNT(*) FROM group_members WHERE group_id=?", [g], |r| r.get(0))?;
    Ok(Some(json!({ "group_id": g, "name": name, "from": public_user(c, &from)?, "members": n, "created_at": at })))
}

/// Invites `who` (a friend of `from`) unless they're already in; tells them in realtime.
fn invite_member(st: &S, c: &Connection, g: &str, from: &str, who: &str) -> R<()> {
    if is_member(c, g, who)? { return Ok(()); }
    c.execute("INSERT OR IGNORE INTO group_invites(group_id, user_id, from_id, created_at) VALUES (?,?,?,?)", params![g, who, from, now_ms()])?;
    if let Some(v) = invite_view(c, g, who)? {
        st.hub.send(who, &json!({ "type": "group_invite", "invite": v }));
    }
    Ok(())
}

async fn list_group_invites(State(st): State<S>, Authed(me): Authed) -> R<Json<Value>> {
    let c = st.db();
    let mut q = c.prepare("SELECT group_id FROM group_invites WHERE user_id=? ORDER BY created_at DESC")?;
    let gs: Vec<String> = q.query_map([&me], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let mut out = Vec::new();
    for g in gs { if let Some(v) = invite_view(&c, &g, &me)? { out.push(v); } }
    Ok(Json(json!({ "invites": out })))
}

async fn group_invite_accept(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>) -> R<Json<Value>> {
    {
        let c = st.db();
        if c.execute("DELETE FROM group_invites WHERE group_id=? AND user_id=?", params![g, me])? == 0 {
            return Err(not_found("That invite is gone"));
        }
        if member_ids(&c, &g)?.len() >= 32 { return Err(bad("Groups are capped at 32 people")); }
        c.execute("INSERT OR IGNORE INTO group_members(group_id, user_id, joined_at) VALUES (?,?,?)", params![g, me, now_ms()])?;
    }
    broadcast_group(&st, &g)?;
    Ok(Json(group_view(&st.db(), &g, &me)?))
}

async fn group_invite_decline(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>) -> R<Json<Value>> {
    st.db().execute("DELETE FROM group_invites WHERE group_id=? AND user_id=?", params![g, me])?;
    let _ = broadcast_group(&st, &g);
    Ok(Json(json!({ "ok": true })))
}

fn tell_group(st: &S, ids: &[String], ev: &Value) {
    for u in ids { st.hub.send(u, ev); }
}

fn broadcast_group(st: &S, g: &str) -> R<()> {
    let (ids, views) = {
        let c = st.db();
        let ids = member_ids(&c, g)?;
        let views: Vec<(String, Value)> = ids.iter().map(|u| group_view(&c, g, u).map(|v| (u.clone(), v))).collect::<R<_>>()?;
        (ids, views)
    };
    let _ = ids;
    for (u, v) in views { st.hub.send(&u, &json!({ "type": "group_updated", "group": v })); }
    Ok(())
}

#[derive(Deserialize)]
struct NewGroup {
    name: String,
    members: Vec<String>,
}

fn clean_name(n: &str) -> R<String> {
    let n = n.trim().to_string();
    if n.is_empty() || n.chars().count() > 40 { return Err(bad("Group names are 1-40 characters")); }
    Ok(n)
}

async fn create_group(State(st): State<S>, Authed(me): Authed, Json(r): Json<NewGroup>) -> R<Json<Value>> {
    let name = clean_name(&r.name)?;
    let mut ids: Vec<String> = r.members.into_iter().filter(|m| *m != me).collect();
    ids.sort();
    ids.dedup();
    if ids.is_empty() || ids.len() > 31 { return Err(bad("Pick 1 to 31 friends")); }
    let id = random_token()[..16].to_string();
    {
        let c = st.db();
        for m in &ids {
            if !are_friends(&c, &me, m)? { return Err(not_friends()); }
        }
        let t = now_ms();
        let tx = c.unchecked_transaction()?;
        tx.execute("INSERT INTO groups(id, name, owner, created_at) VALUES (?,?,?,?)", params![id, name, me, t])?;
        tx.execute("INSERT INTO group_members(group_id, user_id, joined_at) VALUES (?,?,?)", params![id, me, t])?;
        tx.commit()?;
        for u in &ids { invite_member(&st, &c, &id, &me, u)?; }
    }
    broadcast_group(&st, &id)?;
    let v = group_view(&st.db(), &id, &me)?;
    Ok(Json(v))
}

async fn list_groups(State(st): State<S>, Authed(me): Authed) -> R<Json<Value>> {
    let c = st.db();
    let mut q = c.prepare("SELECT group_id FROM group_members WHERE user_id=?")?;
    let gs: Vec<String> = q.query_map([&me], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let v: Vec<Value> = gs.iter().map(|g| group_view(&c, g, &me)).collect::<R<_>>()?;
    Ok(Json(json!({ "groups": v })))
}

async fn group_messages(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>, axum::extract::Query(p): axum::extract::Query<Page>) -> R<Json<Value>> {
    let c = st.db();
    if !is_member(&c, &g, &me)? { return Err(not_found("Group not found")); }
    let mut q = c.prepare(&format!("SELECT {MSG_COLS} FROM messages WHERE a=?1 AND b='#' AND created_at<?2 ORDER BY created_at DESC LIMIT ?3"))?;
    let msgs: Vec<ChatMsg> = q.query_map(params![g, p.before.unwrap_or(i64::MAX), p.limit.unwrap_or(50).clamp(1, 100)], row_msg)?.collect::<rusqlite::Result<_>>()?;
    Ok(Json(json!({ "messages": msgs, "group": group_view(&c, &g, &me)? })))
}

async fn group_send(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>, Json(r): Json<SendMsg>) -> R<Json<ChatMsg>> {
    let body = r.body.trim().to_string();
    if body.is_empty() { return Err(bad("Say something")); }
    if body.chars().count() > 2000 { return Err(bad("That message is too long")); }
    let kind = r.kind.unwrap_or_else(|| "text".into());
    if kind != "text" && kind != "sticker" {
        return Err(bad("Unknown message kind"));
    }
    if kind == "sticker" && !sticker_exists(&st, &body) {
        return Err(not_found("Sticker not found"));
    }
    post_group(&st, me, g, &kind, body, r.meta).await
}

async fn group_photo(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>, Query(p): Query<PhotoMeta>, body: axum::body::Bytes) -> R<Json<ChatMsg>> {
    if !is_member(&st.db(), &g, &me)? { return Err(not_found("Group not found")); }
    let (key, meta) = save_chat_photo(&st, &body, &p).await?;
    post_group(&st, me, g, "image", key, Some(meta)).await
}

async fn post_group(st: &S, me: String, g: String, kind: &str, body: String, meta: Option<String>) -> R<Json<ChatMsg>> {
    let meta = meta.or_else(|| {
        if kind == "sticker" {
            st.db().query_row(
                "SELECT width, height, name FROM stickers WHERE id=?",
                [&body],
                |r| {
                    let w: u32 = r.get(0)?;
                    let h: u32 = r.get(1)?;
                    let name: Option<String> = r.get(2)?;
                    Ok(format!("{}:{}:{}", w, h, name.unwrap_or_default()))
                },
            ).ok()
        } else {
            None
        }
    });
    let (m, ids, title) = {
        let c = st.db();
        if !is_member(&c, &g, &me)? { return Err(not_found("Group not found")); }
        let last: Option<i64> = c.query_row("SELECT MAX(created_at) FROM messages WHERE a=? AND b='#'", [&g], |r| r.get(0))?;
        let t = last.map_or(now_ms(), |l| now_ms().max(l + 1));
        let m = ChatMsg { id: random_token()[..16].to_string(), from: me.clone(), to: g.clone(), kind: kind.into(), body, created_at: t, meta: meta.clone() };
        c.execute("INSERT INTO messages(id, a, b, sender, recipient, kind, body, created_at) VALUES (?,?,'#',?,?,?,?,?)", params![m.id, g, m.from, m.to, m.kind, m.body, m.created_at])?;
        c.execute("UPDATE group_members SET read_at=? WHERE group_id=? AND user_id=?", params![t, g, me])?;
        let gname: String = c.query_row("SELECT name FROM groups WHERE id=?", [&g], |r| r.get(0))?;
        let u = public_user(&c, &me)?;
        (m, member_ids(&c, &g)?, format!("{gname} · {}", label(&u)))
    };
    tell_group(st, &ids, &json!({ "type": "group_message", "group_id": g, "message": &m }));
    let preview: String = if m.kind == "image" { "sent a photo".into() } else { m.body.chars().take(120).collect() };
    for u in ids.iter().filter(|u| **u != me && !st.hub.online(u)) {
        push(st, u, title.clone(), preview.clone(), json!({ "type": "group_message", "group_id": g }));
    }
    Ok(Json(m))
}

#[derive(Deserialize)]
struct GroupReq {
    group_id: String,
}

/// Group walkie-talkie: I publish into `g_<id>`; the recorder relays it into every member's inbox.
async fn rtc_group(State(st): State<S>, Authed(me): Authed, Json(r): Json<GroupReq>) -> R<Json<Value>> {
    let u = {
        let c = st.db();
        if !is_member(&c, &r.group_id, &me)? { return Err(not_found("Group not found")); }
        public_user(&c, &me)?
    };
    let room = format!("g_{}", r.group_id);
    let token = st.lk_token(&me, &label(&u), &room, true, 3600);
    Ok(Json(json!({ "url": st.cfg.lk_url, "room": room, "token": token })))
}

async fn group_talk(st: &S, me: &str, g: &str, on: bool) -> R<Json<Value>> {
    let (ids, u, gname) = {
        let c = st.db();
        if !is_member(&c, g, me)? { return Err(not_found("Group not found")); }
        let gname: String = c.query_row("SELECT name FROM groups WHERE id=?", [g], |r| r.get(0))?;
        (member_ids(&c, g)?, public_user(&c, me)?, gname)
    };
    let others: Vec<&String> = ids.iter().filter(|u| u.as_str() != me).collect();
    if on {
        let name = label(&u);
        recorder(st, "/gstart", json!({ "group": g, "from": me, "to": others, "name": name }));
        bump(st, me, "group_talks", 1);
        tell_group(st, &ids, &json!({ "type": "group_talk_started", "group_id": g, "from": &u }));
        for m in others.iter().filter(|m| !st.hub.online(m)) {
            push(st, m, format!("{gname} · {name}"), "is talking".into(), json!({ "type": "ptt", "from": me, "group_id": g }));
        }
    } else {
        recorder(st, "/gstop", json!({ "group": g, "from": me }));
        tell_group(st, &ids, &json!({ "type": "group_talk_stopped", "group_id": g, "from_id": me }));
    }
    Ok(Json(json!({ "ok": true })))
}

async fn group_talk_start(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>) -> R<Json<Value>> {
    group_talk(&st, &me, &g, true).await
}

async fn group_talk_stop(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>) -> R<Json<Value>> {
    group_talk(&st, &me, &g, false).await
}

async fn group_read(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>, Json(r): Json<ReadReq>) -> R<Json<Value>> {
    let at = r.at.min(now_ms() + 60_000);
    let ids = {
        let c = st.db();
        if !is_member(&c, &g, &me)? { return Err(not_found("Group not found")); }
        c.execute("UPDATE group_members SET read_at=MAX(read_at, ?) WHERE group_id=? AND user_id=?", params![at, g, me])?;
        member_ids(&c, &g)?
    };
    tell_group(&st, &ids, &json!({ "type": "group_read", "group_id": g, "user_id": me, "at": at }));
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct GroupPatch {
    name: Option<String>,
    background: Option<Option<String>>,
}

async fn group_patch(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>, Json(r): Json<GroupPatch>) -> R<Json<Value>> {
    let old_bg = {
        let c = st.db();
        if !is_member(&c, &g, &me)? { return Err(not_found("Group not found")); }
        if let Some(n) = &r.name { c.execute("UPDATE groups SET name=? WHERE id=?", params![clean_name(n)?, g])?; }
        let mut old = None;
        if let Some(bg) = &r.background {
            if bg.as_deref().is_some_and(|b| b.starts_with("b-") || b.len() > 64) { return Err(bad("Unknown background")); }
            old = c.query_row("SELECT background FROM groups WHERE id=?", [&g], |r| r.get::<_, Option<String>>(0))?;
            c.execute("UPDATE groups SET background=? WHERE id=?", params![bg, g])?;
        }
        old
    };
    if let Some(o) = old_bg { drop_media(&st, o).await; }
    broadcast_group(&st, &g)?;
    Ok(Json(group_view(&st.db(), &g, &me)?))
}

async fn group_background_photo(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>, body: axum::body::Bytes) -> R<Json<Value>> {
    let Some((ext, ctype)) = crate::storage::image_kind(&body).filter(|_| body.len() >= 100) else { return Err(bad("Upload a JPEG or WebP photo")); };
    let store = crate::storage::get().ok_or_else(|| bad("Photo backgrounds aren't available"))?;
    if !is_member(&st.db(), &g, &me)? { return Err(not_found("Group not found")); }
    let key = crate::storage::key_for("b", &body, ext);
    store.put(&key, body.to_vec(), ctype).await.map_err(|e| { tracing::error!(error = %e, "b2 put"); bad("Couldn't save photo") })?;
    let old: Option<String> = {
        let c = st.db();
        let old = c.query_row("SELECT background FROM groups WHERE id=?", [&g], |r| r.get(0))?;
        c.execute("UPDATE groups SET background=? WHERE id=?", params![key, g])?;
        old
    };
    if let Some(o) = old.filter(|o| *o != key) { drop_media(&st, o).await; }
    broadcast_group(&st, &g)?;
    Ok(Json(group_view(&st.db(), &g, &me)?))
}

#[derive(Deserialize)]
struct AddMember {
    user_id: String,
}

async fn group_add(State(st): State<S>, Authed(me): Authed, Path(g): Path<String>, Json(r): Json<AddMember>) -> R<Json<Value>> {
    {
        let c = st.db();
        if !is_member(&c, &g, &me)? { return Err(not_found("Group not found")); }
        if !are_friends(&c, &me, &r.user_id)? { return Err(not_friends()); }
        if member_ids(&c, &g)?.len() >= 32 { return Err(bad("Groups are capped at 32 people")); }
        invite_member(&st, &c, &g, &me, &r.user_id)?;
    }
    broadcast_group(&st, &g)?;
    Ok(Json(group_view(&st.db(), &g, &me)?))
}

async fn group_remove(State(st): State<S>, Authed(me): Authed, Path((g, who)): Path<(String, String)>) -> R<Json<Value>> {
    let (empty, bg, images) = {
        let c = st.db();
        if !is_member(&c, &g, &me)? { return Err(not_found("Group not found")); }
        let owner: String = c.query_row("SELECT owner FROM groups WHERE id=?", [&g], |r| r.get(0))?;
        if who != me && owner != me { return Err(err(StatusCode::FORBIDDEN, "Forbidden", "Only the group's creator can remove people")); }
        c.execute("DELETE FROM group_members WHERE group_id=? AND user_id=?", params![g, who])?;
        let left = member_ids(&c, &g)?;
        if left.is_empty() {
            let bg: Option<String> = c.query_row("SELECT background FROM groups WHERE id=?", [&g], |r| r.get(0))?;
            let mut q = c.prepare("SELECT body FROM messages WHERE a=? AND b='#' AND kind='image'")?;
            let imgs: Vec<String> = q.query_map([&g], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            c.execute("DELETE FROM messages WHERE a=? AND b='#'", [&g])?;
            c.execute("DELETE FROM groups WHERE id=?", [&g])?;
            (true, bg, imgs)
        } else {
            if who == owner { c.execute("UPDATE groups SET owner=? WHERE id=?", params![left[0], g])?; }
            (false, None, Vec::new())
        }
    };
    st.hub.send(&who, &json!({ "type": "group_left", "group_id": g }));
    if empty {
        for k in bg.into_iter().chain(images) { drop_media(&st, k).await; }
    } else {
        broadcast_group(&st, &g)?;
    }
    Ok(Json(json!({ "ok": true })))
}

// ---------- event stream ----------

#[derive(Deserialize)]
struct StreamQ {
    access_token: String,
}

async fn stream(State(st): State<S>, Query(q): Query<StreamQ>, ws: WebSocketUpgrade) -> R<Response> {
    let uid = st.verify_access(&q.access_token).ok_or_else(unauthorized)?;
    Ok(ws.read_buffer_size(4096).write_buffer_size(0).max_message_size(64 * 1024).on_upgrade(move |sock| run_ws(st, uid, sock)))
}

async fn run_ws(st: S, uid: String, mut sock: WebSocket) {
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let (cid, first) = st.hub.register(&uid, tx);
    if first {
        broadcast_status(&st, &uid);
    }
    let _ = sock.send(Message::Text(json!({ "type": "hello" }).to_string().into())).await;
    let mut ping = tokio::time::interval(Duration::from_secs(15));
    let mut last_seen = Instant::now();
    loop {
        tokio::select! {
            m = rx.recv() => match m {
                Some(m) => if sock.send(Message::Text(m.into())).await.is_err() { break },
                None => break,
            },
            _ = ping.tick() => {
                if last_seen.elapsed() > Duration::from_secs(45) { break }
                if sock.send(Message::Ping(Vec::new().into())).await.is_err() { break }
            }
            m = sock.recv() => match m {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(Message::Text(t))) => {
                    last_seen = Instant::now();
                    if t.as_str() == "ping" && sock.send(Message::Text("{\"type\":\"pong\"}".into())).await.is_err() { break }
                }
                Some(Ok(_)) => last_seen = Instant::now(),
            },
        }
    }
    if st.hub.unregister(&uid, cid) {
        broadcast_status(&st, &uid);
    }
}

// Sticker & Custom Emoji Data Models and Handlers

#[derive(Serialize, Deserialize)]
pub struct StickerItem {
    pub id: String,
    pub url: String,
    pub is_animated: bool,
    pub is_emoji: bool,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u32,
    pub alt_emoji: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct StickerPackView {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub owner_id: Option<String>,
    pub is_emoji_pack: bool,
    pub thumbnail_url: Option<String>,
    pub stickers: Vec<StickerItem>,
}

#[derive(Deserialize)]
pub struct CreatePackReq {
    pub slug: String,
    pub title: String,
    pub is_emoji_pack: Option<bool>,
    pub sticker_ids: Vec<String>,
    pub alt_emojis: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub struct UploadStickerQuery {
    pub is_emoji: Option<bool>,
    pub alt_emoji: Option<String>,
    pub name: Option<String>,
}

async fn upload_sticker(
    State(st): State<S>,
    Authed(me): Authed,
    Query(q): Query<UploadStickerQuery>,
    body: axum::body::Bytes,
) -> R<Json<StickerItem>> {
    if body.is_empty() {
        return Err(bad("Upload file is empty"));
    }
    {
        let mut e = st.sticker_uploads.entry(me.clone()).or_default();
        e.retain(|t| t.elapsed() < Duration::from_secs(3600));
        if e.len() >= 25 {
            return Err(bad("Too many uploads — try again in an hour"));
        }
        e.push(Instant::now());
    }
    let is_emoji = q.is_emoji.unwrap_or(false);
    let name = q.name.as_deref().map(|s| s.trim().to_lowercase().replace(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-', "")).filter(|s| !s.is_empty());

    // Convert (and compress/scale) using ffmpeg pipeline
    let converted = crate::converter::convert_to_optimized_webp(&body, is_emoji)
        .await
        .map_err(|e| bad(e))?;

    let store = crate::storage::get().ok_or_else(|| bad("Sticker storage is currently unavailable"))?;
    let key = crate::storage::key_for("s", &converted.webp_bytes, "webp");

    let known: Option<(u32, u32, i64, u32, Option<String>)> = {
        let c = st.db();
        c.query_row(
            "SELECT width, height, is_animated, size_bytes, name FROM stickers WHERE id=?",
            [&key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        ).optional()?
    };

    let (width, height, is_anim, size_bytes, final_name) = if let Some((w, h, a, s, existing_name)) = known {
        let n = if name.is_some() {
            let _ = st.db().execute("UPDATE stickers SET name=? WHERE id=?", params![&name, &key]);
            name
        } else {
            existing_name
        };
        (w, h, a != 0, s, n)
    } else {
        // Upload to B2
        store
            .put(&key, converted.webp_bytes.clone(), "image/webp")
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "b2 sticker put");
                bad("Couldn't save sticker")
            })?;

        let now = now_ms();
        let size = converted.webp_bytes.len() as u32;
        st.db().execute(
            "INSERT OR IGNORE INTO stickers(id, hash, mime, is_animated, is_emoji, width, height, size_bytes, name, created_at)
             VALUES (?1, ?1, 'image/webp', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![key, converted.is_animated as i64, is_emoji as i64, converted.width, converted.height, size, &name, now],
        )?;
        (converted.width, converted.height, converted.is_animated, size, name)
    };

    Ok(Json(StickerItem {
        id: key.clone(),
        url: store.url(&key),
        is_animated: is_anim,
        is_emoji,
        width,
        height,
        size_bytes,
        alt_emoji: q.alt_emoji,
        name: final_name,
    }))
}

async fn list_sticker_packs(State(st): State<S>, Authed(me): Authed) -> R<Json<Vec<StickerPackView>>> {
    let c = st.db();
    let mut q = c.prepare(
        "SELECT id, slug, title, owner_id, is_emoji_pack, thumbnail_id FROM sticker_packs
         WHERE owner_id IS NULL OR owner_id = ?
         ORDER BY created_at DESC LIMIT 50",
    )?;

    let store = crate::storage::get();
    let pack_rows = q.query_map([&me], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, i64>(4)? != 0,
            r.get::<_, Option<String>>(5)?,
        ))
    })?.collect::<rusqlite::Result<Vec<_>>>()?;

    let mut out = Vec::new();
    for (id, slug, title, owner_id, is_emoji_pack, thumb) in pack_rows {
        let mut sq = c.prepare(
            "SELECT s.id, s.is_animated, s.is_emoji, s.width, s.height, s.size_bytes, i.alt_emoji, s.name
             FROM sticker_pack_items i
             JOIN stickers s ON s.id = i.sticker_id
             WHERE i.pack_id = ?
             ORDER BY i.position ASC",
        )?;
        let stickers = sq.query_map([&id], |r| {
            let sid: String = r.get(0)?;
            let url = store.map(|s| s.url(&sid)).unwrap_or_default();
            Ok(StickerItem {
                id: sid,
                url,
                is_animated: r.get::<_, i64>(1)? != 0,
                is_emoji: r.get::<_, i64>(2)? != 0,
                width: r.get(3)?,
                height: r.get(4)?,
                size_bytes: r.get(5)?,
                alt_emoji: r.get(6)?,
                name: r.get(7)?,
            })
        })?.collect::<rusqlite::Result<Vec<_>>>()?;

        let thumbnail_url = thumb.as_deref().and_then(|t| store.map(|s| s.url(t)));
        out.push(StickerPackView {
            id,
            slug,
            title,
            owner_id,
            is_emoji_pack,
            thumbnail_url,
            stickers,
        });
    }

    Ok(Json(out))
}

async fn create_sticker_pack(
    State(st): State<S>,
    Authed(me): Authed,
    Json(r): Json<CreatePackReq>,
) -> R<Json<StickerPackView>> {
    let slug = r.slug.trim().to_lowercase();
    if slug.len() < 3 || slug.len() > 32 || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(bad("Slug must be 3-32 alphanumeric characters"));
    }
    let title = r.title.trim();
    if title.is_empty() || title.len() > 64 {
        return Err(bad("Title must be 1-64 characters"));
    }
    if r.sticker_ids.is_empty() || r.sticker_ids.len() > 100 {
        return Err(bad("Pack must have between 1 and 100 stickers"));
    }

    let is_emoji_pack = r.is_emoji_pack.unwrap_or(false);
    let pack_id = random_token()[..16].to_string();
    let now = now_ms();
    let thumb = r.sticker_ids.first().cloned();

    {
        let c = st.db();
        c.execute(
            "INSERT INTO sticker_packs(id, slug, title, owner_id, is_emoji_pack, thumbnail_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![pack_id, slug, title, me, is_emoji_pack as i64, thumb, now],
        ).map_err(|e| {
            if let rusqlite::Error::SqliteFailure(err, _) = &e {
                if err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE {
                    return bad("A pack with this slug already exists");
                }
            }
            e.into()
        })?;

        for (pos, sid) in r.sticker_ids.iter().enumerate() {
            let alt = r.alt_emojis.as_ref().and_then(|a| a.get(pos)).cloned().unwrap_or_default();
            c.execute(
                "INSERT OR REPLACE INTO sticker_pack_items(pack_id, sticker_id, position, alt_emoji)
                 VALUES (?1, ?2, ?3, ?4)",
                params![pack_id, sid, pos as i64, alt],
            )?;
        }
    }

    let store = crate::storage::get();
    let thumbnail_url = thumb.as_deref().and_then(|t| store.map(|s| s.url(t)));

    Ok(Json(StickerPackView {
        id: pack_id,
        slug,
        title: title.into(),
        owner_id: Some(me),
        is_emoji_pack,
        thumbnail_url,
        stickers: Vec::new(),
    }))
}

async fn get_sticker_pack(
    State(st): State<S>,
    Authed(_me): Authed,
    Path(slug): Path<String>,
) -> R<Json<StickerPackView>> {
    let c = st.db();
    let (id, slug, title, owner_id, is_emoji_pack, thumb): (String, String, String, Option<String>, bool, Option<String>) = c.query_row(
        "SELECT id, slug, title, owner_id, is_emoji_pack, thumbnail_id FROM sticker_packs WHERE slug = ? OR id = ?",
        [&slug, &slug],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, i64>(4)? != 0, r.get(5)?)),
    ).optional()?.ok_or_else(|| not_found("Sticker pack not found"))?;

    let store = crate::storage::get();
    let mut sq = c.prepare(
        "SELECT s.id, s.is_animated, s.is_emoji, s.width, s.height, s.size_bytes, i.alt_emoji, s.name
         FROM sticker_pack_items i
         JOIN stickers s ON s.id = i.sticker_id
         WHERE i.pack_id = ?
         ORDER BY i.position ASC",
    )?;
    let stickers = sq.query_map([&id], |r| {
        let sid: String = r.get(0)?;
        let url = store.map(|s| s.url(&sid)).unwrap_or_default();
        Ok(StickerItem {
            id: sid,
            url,
            is_animated: r.get::<_, i64>(1)? != 0,
            is_emoji: r.get::<_, i64>(2)? != 0,
            width: r.get(3)?,
            height: r.get(4)?,
            size_bytes: r.get(5)?,
            alt_emoji: r.get(6)?,
            name: r.get(7)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;

    let thumbnail_url = thumb.as_deref().and_then(|t| store.map(|s| s.url(t)));
    Ok(Json(StickerPackView {
        id,
        slug,
        title,
        owner_id,
        is_emoji_pack,
        thumbnail_url,
        stickers,
    }))
}

async fn use_recent_sticker(
    State(st): State<S>,
    Authed(me): Authed,
    Path(sid): Path<String>,
) -> R<Json<Value>> {
    if !sticker_exists(&st, &sid) {
        return Err(not_found("Sticker not found"));
    }
    let now = now_ms();
    st.db().execute(
        "INSERT INTO user_recent_stickers(user_id, sticker_id, used_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, sticker_id) DO UPDATE SET used_at=excluded.used_at",
        params![me, sid, now],
    )?;
    Ok(Json(json!({ "ok": true })))
}

async fn list_recent_stickers(
    State(st): State<S>,
    Authed(me): Authed,
) -> R<Json<Vec<StickerItem>>> {
    let c = st.db();
    let store = crate::storage::get();
    let mut q = c.prepare(
        "SELECT s.id, s.is_animated, s.is_emoji, s.width, s.height, s.size_bytes, s.name
         FROM user_recent_stickers r
         JOIN stickers s ON s.id = r.sticker_id
         WHERE r.user_id = ?
         ORDER BY r.used_at DESC LIMIT 50",
    )?;
    let items = q.query_map([&me], |r| {
        let sid: String = r.get(0)?;
        let url = store.map(|s| s.url(&sid)).unwrap_or_default();
        Ok(StickerItem {
            id: sid,
            url,
            is_animated: r.get::<_, i64>(1)? != 0,
            is_emoji: r.get::<_, i64>(2)? != 0,
            width: r.get(3)?,
            height: r.get(4)?,
            size_bytes: r.get(5)?,
            alt_emoji: None,
            name: r.get(6)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(items))
}

async fn resolve_sticker(
    State(st): State<S>,
    Authed(_me): Authed,
    Path(name): Path<String>,
) -> R<Json<StickerItem>> {
    let c = st.db();
    let store = crate::storage::get();
    let clean = name.trim().to_lowercase();
    let item = c.query_row(
        "SELECT id, is_animated, is_emoji, width, height, size_bytes, name FROM stickers WHERE name = ?1 OR id = ?1 LIMIT 1",
        [&clean],
        |r| {
            let sid: String = r.get(0)?;
            let url = store.map(|s| s.url(&sid)).unwrap_or_default();
            Ok(StickerItem {
                id: sid,
                url,
                is_animated: r.get::<_, i64>(1)? != 0,
                is_emoji: r.get::<_, i64>(2)? != 0,
                width: r.get(3)?,
                height: r.get(4)?,
                size_bytes: r.get(5)?,
                alt_emoji: None,
                name: r.get(6)?,
            })
        },
    ).optional()?;

    item.map(Json).ok_or_else(|| not_found("Sticker not found"))
}

async fn list_all_stickers(
    State(st): State<S>,
    Authed(_me): Authed,
) -> R<Json<Vec<StickerItem>>> {
    let c = st.db();
    let store = crate::storage::get();
    let mut q = c.prepare(
        "SELECT id, is_animated, is_emoji, width, height, size_bytes, name FROM stickers WHERE name IS NOT NULL AND name != '' ORDER BY created_at DESC LIMIT 200",
    )?;
    let items = q.query_map([], |r| {
        let sid: String = r.get(0)?;
        let url = store.map(|s| s.url(&sid)).unwrap_or_default();
        Ok(StickerItem {
            id: sid,
            url,
            is_animated: r.get::<_, i64>(1)? != 0,
            is_emoji: r.get::<_, i64>(2)? != 0,
            width: r.get(3)?,
            height: r.get(4)?,
            size_bytes: r.get(5)?,
            alt_emoji: None,
            name: r.get(6)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(items))
}

pub fn router(st: S) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/v1/version", get(version))
        .route("/v1/auth/start", post(auth_start))
        .route("/v1/auth/confirm", post(auth_confirm))
        .route("/v1/auth/google", post(auth_google))
        .route("/v1/auth/exchange", post(auth_exchange))
        .route("/auth/google", get(google_start))
        .route("/auth/google/popup", get(google_signin_page))
        .route("/auth/google/cb", get(google_cb))
        .route("/v1/auth/refresh", post(auth_refresh))
        .route("/v1/auth/logout", post(auth_logout))
        .route("/v1/me", get(get_me).patch(patch_me).delete(delete_me))
        .route("/v1/me/avatar", put(put_avatar).layer(DefaultBodyLimit::max(3 * 1024 * 1024)))
        .route("/v1/me/pfp", put(put_pfp).layer(DefaultBodyLimit::max(1024 * 1024)))
        .route("/avatars/{file}", get(get_avatar))
        .route("/v1/status", put(set_status))
        .route("/v1/users/{username}", get(lookup_user))
        .route("/v1/friends", get(list_friends))
        .route("/v1/friends/order", put(update_friend_order))
        .route("/v1/friends/{id}", axum::routing::delete(remove_friend))
        .route("/v1/friends/requests", get(list_requests).post(send_request))
        .route("/v1/friends/requests/{id}/accept", post(accept_request))
        .route("/v1/friends/requests/{id}", axum::routing::delete(delete_request))
        .route("/v1/blocks", get(list_blocks).post(block_user))
        .route("/v1/blocks/{id}", axum::routing::delete(unblock_user))
        .route("/v1/reports", post(report_user))
        .route("/v1/admin/overview", get(admin_overview))
        .route("/v1/admin/reports", get(admin_reports))
        .route("/v1/admin/reports/{id}", post(admin_report_status))
        .route("/v1/admin/users", get(admin_users))
        .route("/v1/admin/users/{id}/ban", post(admin_ban))
        .route("/v1/admin/bans", get(admin_bans))
        .route("/v1/admin/bans/{email}", axum::routing::delete(admin_unban))
        .route("/v1/devices", post(add_device).delete(remove_device))
        .route("/v1/notifications", get(get_notifs).put(put_notifs))
        .route("/v1/notifications/mute", put(put_mute))
        .route("/v1/rtc/listen", post(rtc_listen))
        .route("/v1/rtc/focus", post(rtc_focus))
        .route("/v1/ptt/start", post(ptt_start))
        .route("/v1/ptt/stop", post(ptt_stop))
        .route("/v1/clips", get(list_clips))
        .route("/v1/me/achievements", get(achievements))
        .route("/v1/clips/{id}/play", post(play_clip))
        .route("/v1/clips/{id}/seen", post(seen_clip))
        .route("/internal/clips", post(internal_clip))
        .route("/{seg}", get(invite_page))
        .route("/v1/call/start", post(call_start))
        .route("/v1/call/accept", post(call_accept))
        .route("/v1/call/end", post(call_end))
        .route("/v1/chats", get(list_chats))
        .route("/v1/groups", get(list_groups).post(create_group))
        .route("/v1/groups/{id}", axum::routing::patch(group_patch))
        .route("/v1/groups/{id}/messages", get(group_messages).post(group_send))
        .route("/v1/groups/{id}/photo", post(group_photo).layer(DefaultBodyLimit::max(4 * 1024 * 1024)))
        .route("/v1/groups/{id}/read", post(group_read))
        .route("/v1/groups/{id}/talk/start", post(group_talk_start))
        .route("/v1/groups/{id}/talk/stop", post(group_talk_stop))
        .route("/v1/rtc/group", post(rtc_group))
        .route("/v1/groups/{id}/background/photo", put(group_background_photo).layer(DefaultBodyLimit::max(3 * 1024 * 1024)))
        .route("/v1/groups/{id}/members", post(group_add))
        .route("/v1/groups/invites", get(list_group_invites))
        .route("/v1/groups/{id}/invite/accept", post(group_invite_accept))
        .route("/v1/groups/{id}/invite/decline", post(group_invite_decline))
        .route("/v1/groups/{id}/members/{uid}", axum::routing::delete(group_remove))
        .route("/v1/chats/{id}/messages", get(list_messages).post(send_message))
        .route("/v1/chats/{id}", axum::routing::delete(delete_chat))
        .route("/v1/chats/{id}/messages/{mid}", axum::routing::delete(delete_dm_message))
        .route("/v1/groups/{id}/messages/{mid}", axum::routing::delete(delete_group_message))
        .route("/v1/chats/{id}/photos", get(chat_photos))
        .route("/v1/chats/{id}/photo", post(send_photo).layer(DefaultBodyLimit::max(4 * 1024 * 1024)))
        .route("/v1/chats/{id}/read", post(mark_read))
        .route("/v1/chats/{id}/background", put(set_chat_background))
        .route("/v1/chats/{id}/background/photo", put(put_chat_background_photo).layer(DefaultBodyLimit::max(3 * 1024 * 1024)))
        .route("/v1/stickers", get(list_all_stickers))
        .route("/v1/stickers/resolve/{name}", get(resolve_sticker))
        .route("/v1/stickers/upload", post(upload_sticker).layer(DefaultBodyLimit::max(3 * 1024 * 1024)))
        .route("/v1/sticker-packs", get(list_sticker_packs).post(create_sticker_pack))
        .route("/v1/sticker-packs/{slug}", get(get_sticker_pack))
        .route("/v1/stickers/recent", get(list_recent_stickers))
        .route("/v1/stickers/recent/{sid}", post(use_recent_sticker))
        .route("/v1/stickers/{sid}/save", post(use_recent_sticker))
        .route("/v1/poke", post(poke))
        .route("/v1/wave", post(wave))
        .route("/v1/stream", get(stream))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(st)
}

#[cfg(test)]
mod streak_tests {
    use super::*;

    #[test]
    fn streaks_require_both_sides_each_day_and_keep_the_longest() {
        const DAY_MS: i64 = 86_400_000;
        let c = db::open(":memory:").unwrap();
        c.execute("INSERT INTO users(id, email, created_at) VALUES (?1, ?2, 0)", params!["a", "a@example.com"]).unwrap();
        c.execute("INSERT INTO users(id, email, created_at) VALUES (?1, ?2, 0)", params!["b", "b@example.com"]).unwrap();
        let day = 20_000;
        let first = day * DAY_MS + 1234;

        assert_eq!(touch_streak_at(&c, "a", "b", first).unwrap_or_else(|_| panic!("streak update failed")), (0, first));
        assert_eq!(touch_streak_at(&c, "b", "a", first + 1).unwrap_or_else(|_| panic!("streak update failed")).0, 1);

        let next_day = first + DAY_MS;
        assert_eq!(touch_streak_at(&c, "a", "b", next_day).unwrap_or_else(|_| panic!("streak update failed")).0, 1);
        assert_eq!(touch_streak_at(&c, "b", "a", next_day + 1).unwrap_or_else(|_| panic!("streak update failed")).0, 2);

        let after_skip = next_day + 2 * DAY_MS;
        assert_eq!(touch_streak_at(&c, "a", "b", after_skip).unwrap_or_else(|_| panic!("streak update failed")).0, 0);
        assert_eq!(touch_streak_at(&c, "b", "a", after_skip + 1).unwrap_or_else(|_| panic!("streak update failed")).0, 1);
        let (a, b) = db::pair("a", "b");
        let longest: i64 = c.query_row("SELECT longest FROM streaks WHERE a=?1 AND b=?2", params![a, b], |r| r.get(0)).unwrap();
        assert_eq!(longest, 2);
    }

    #[test]
    fn friend_order_ignores_non_friends_and_appends_unordered_friends() {
        let c = db::open(":memory:").unwrap();
        for id in ["me", "f1", "f2", "f3", "f4", "stranger"] {
            c.execute(
                "INSERT INTO users(id, email, created_at) VALUES (?1, ?2, 0)",
                params![id, format!("{id}@example.com")],
            )
            .unwrap();
        }
        for (friend, created_at) in [("f1", 10), ("f2", 20), ("f3", 30), ("f4", 40)] {
            let (a, b) = db::pair("me", friend);
            c.execute(
                "INSERT INTO friendships(a, b, created_at) VALUES (?1, ?2, ?3)",
                params![a, b, created_at],
            )
            .unwrap();
        }

        let ids = ["f4", "stranger", "f4", "f3"].map(str::to_string);
        save_friend_order(&c, "me", &ids).unwrap();
        let ordered = friend_list(&c, "me", |_| false)
            .unwrap_or_else(|_| panic!("friend list query failed"));
        let ids: Vec<String> = ordered.into_iter().map(|friend| friend.user.id).collect();
        assert_eq!(ids, ["f4", "f3", "f1", "f2"]);
    }
}
