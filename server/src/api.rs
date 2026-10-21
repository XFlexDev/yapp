use crate::{db, util::*, AppState};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, FromRequestParts, Path, Query, State,
    },
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
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
}

#[derive(Serialize)]
struct Me {
    id: String,
    email: String,
    username: Option<String>,
    display_name: String,
    color: i64,
    avatar: Option<String>,
    dnd: bool,
}

#[derive(Serialize)]
struct Friend {
    #[serde(flatten)]
    user: PublicUser,
    online: bool,
    dnd: bool,
    since: i64,
}

const USER_COLS: &str = "u.id, u.username, u.display_name, u.color, u.avatar";

fn row_user(r: &Row, o: usize) -> rusqlite::Result<PublicUser> {
    Ok(PublicUser { id: r.get(o)?, username: r.get(o + 1)?, display_name: r.get(o + 2)?, color: r.get(o + 3)?, avatar: r.get(o + 4)? })
}

fn public_user(c: &Connection, id: &str) -> R<PublicUser> {
    c.query_row(&format!("SELECT {USER_COLS} FROM users u WHERE u.id=?"), [id], |r| row_user(r, 0))
        .optional()?
        .ok_or_else(|| not_found("User not found"))
}

fn me_of(c: &Connection, id: &str) -> R<Me> {
    c.query_row(
        "SELECT id, email, username, display_name, color, dnd, avatar FROM users WHERE id=?",
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

fn friend_view(st: &AppState, c: &Connection, viewer: &str, other: &str) -> R<Friend> {
    let (a, b) = db::pair(viewer, other);
    c.query_row(
        &format!(
            "SELECT {USER_COLS}, u.dnd, f.created_at FROM friendships f JOIN users u ON u.id=?3 WHERE f.a=?1 AND f.b=?2"
        ),
        [a, b, other],
        |r| {
            Ok(Friend {
                user: row_user(r, 0)?,
                online: st.hub.online(other),
                dnd: r.get::<_, i64>(5)? != 0,
                since: r.get(6)?,
            })
        },
    )
    .optional()?
    .ok_or_else(not_friends)
}

fn status_event(st: &AppState, uid: &str, dnd: bool) -> Value {
    json!({ "type": "friend_status_updated", "user_id": uid, "online": st.hub.online(uid), "dnd": dnd })
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

// ---------- auth ----------

#[derive(Deserialize)]
struct StartReq {
    email: String,
}

async fn auth_start(State(st): State<S>, Json(r): Json<StartReq>) -> R<Json<Value>> {
    let email = normalize_email(&r.email).ok_or_else(|| bad("Enter a valid email"))?;
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

async fn auth_confirm(State(st): State<S>, Json(r): Json<ConfirmReq>) -> R<Json<TokenResp>> {
    let email = normalize_email(&r.email).ok_or_else(|| bad("Enter a valid email"))?;
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
        "user": PublicUser { id: me.id.clone(), username: me.username.clone(), display_name: me.display_name.clone(), color: me.color, avatar: me.avatar.clone() },
    });
    for f in friends {
        st.hub.send(&f, &ev);
    }
    Ok(Json(me))
}

async fn delete_me(State(st): State<S>, Authed(uid): Authed) -> R<Json<Value>> {
    let friends = {
        let c = st.db();
        let f = friend_ids(&c, &uid)?;
        let av: Option<String> = c.query_row("SELECT avatar FROM users WHERE id=?", [&uid], |r| r.get(0))?;
        if let Some(a) = av {
            let _ = std::fs::remove_file(std::path::Path::new(&st.cfg.avatar_dir).join(a));
        }
        c.execute("DELETE FROM users WHERE id=?", [&uid])?;
        f
    };
    for f in friends {
        st.hub.send(&f, &json!({ "type": "friendship_deleted", "user_id": uid }));
    }
    Ok(Json(json!({ "ok": true })))
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
        && f.strip_suffix(".jpg").is_some_and(|b| !b.is_empty() && b.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
}

async fn put_avatar(State(st): State<S>, Authed(uid): Authed, body: axum::body::Bytes) -> R<Json<Me>> {
    if body.len() < 100 || !body.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Err(bad("Upload a JPEG photo"));
    }
    let name = format!("{uid}-{}.jpg", &random_token()[..12]);
    let dir = std::path::PathBuf::from(&st.cfg.avatar_dir);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| { tracing::error!(error = %e, "avatar dir"); bad("Couldn't save photo") })?;
    tokio::fs::write(dir.join(&name), &body).await.map_err(|e| { tracing::error!(error = %e, "avatar write"); bad("Couldn't save photo") })?;
    let (old, me, friends) = {
        let c = st.db();
        let old: Option<String> = c.query_row("SELECT avatar FROM users WHERE id=?", [&uid], |r| r.get(0))?;
        c.execute("UPDATE users SET avatar=? WHERE id=?", [&name, &uid])?;
        (old, me_of(&c, &uid)?, friend_ids(&c, &uid)?)
    };
    if let Some(o) = old {
        let _ = tokio::fs::remove_file(dir.join(o)).await;
    }
    let ev = json!({
        "type": "friend_profile_updated",
        "user": PublicUser { id: me.id.clone(), username: me.username.clone(), display_name: me.display_name.clone(), color: me.color, avatar: me.avatar.clone() },
    });
    for f in friends {
        st.hub.send(&f, &ev);
    }
    Ok(Json(me))
}

async fn get_avatar(State(st): State<S>, Path(file): Path<String>) -> Response {
    if !valid_avatar_name(&file) {
        return StatusCode::NOT_FOUND.into_response();
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

async fn lookup_user(State(st): State<S>, Authed(_): Authed, Path(username): Path<String>) -> R<Json<PublicUser>> {
    let u = username.trim().trim_start_matches('@').to_lowercase();
    let c = st.db();
    c.query_row(&format!("SELECT {USER_COLS} FROM users u WHERE u.username=?"), [&u], |r| row_user(r, 0))
        .optional()?
        .map(Json)
        .ok_or_else(|| not_found("No one has that username"))
}

async fn list_friends(State(st): State<S>, Authed(uid): Authed) -> R<Json<Vec<Friend>>> {
    let c = st.db();
    let mut s = c.prepare(&format!(
        "SELECT {USER_COLS}, u.dnd, f.created_at FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.a=?1 THEN f.b ELSE f.a END
         WHERE f.a=?1 OR f.b=?1 ORDER BY f.created_at DESC"
    ))?;
    let v = s
        .query_map([&uid], |r| {
            let user = row_user(r, 0)?;
            Ok(Friend { online: st.hub.online(&user.id), user, dnd: r.get::<_, i64>(5)? != 0, since: r.get(6)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(v))
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
        if st.db().execute("DELETE FROM friendships WHERE a=? AND b=?", [a, b])? == 0 {
            return Err(not_friends());
        }
    }
    st.hub.send(&other, &json!({ "type": "friendship_deleted", "user_id": me }));
    st.hub.send(&me, &json!({ "type": "friendship_deleted", "user_id": other }));
    Ok(Json(json!({ "ok": true })))
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
    Ok(Json(json!({ "ok": true })))
}

async fn poke(State(st): State<S>, Authed(me): Authed, Json(r): Json<FriendReq>) -> R<Json<Value>> {
    let key = (me.clone(), r.friend_id.clone());
    if st.pokes.get(&key).is_some_and(|t| t.elapsed() < Duration::from_secs(3)) {
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
    st.hub.send(&r.friend_id, &json!({ "type": "poke", "from": &u }));
    if !online {
        push(&st, &r.friend_id, label(&u), "poked you".into(), json!({ "type": "poke", "from": u.id }));
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
    Ok(ws.on_upgrade(move |sock| run_ws(st, uid, sock)))
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

pub fn router(st: S) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/v1/version", get(version))
        .route("/v1/auth/start", post(auth_start))
        .route("/v1/auth/confirm", post(auth_confirm))
        .route("/v1/auth/refresh", post(auth_refresh))
        .route("/v1/auth/logout", post(auth_logout))
        .route("/v1/me", get(get_me).patch(patch_me).delete(delete_me))
        .route("/v1/me/avatar", put(put_avatar).layer(DefaultBodyLimit::max(3 * 1024 * 1024)))
        .route("/avatars/{file}", get(get_avatar))
        .route("/v1/status", put(set_status))
        .route("/v1/users/{username}", get(lookup_user))
        .route("/v1/friends", get(list_friends))
        .route("/v1/friends/{id}", axum::routing::delete(remove_friend))
        .route("/v1/friends/requests", get(list_requests).post(send_request))
        .route("/v1/friends/requests/{id}/accept", post(accept_request))
        .route("/v1/friends/requests/{id}", axum::routing::delete(delete_request))
        .route("/v1/devices", post(add_device).delete(remove_device))
        .route("/v1/rtc/listen", post(rtc_listen))
        .route("/v1/rtc/focus", post(rtc_focus))
        .route("/v1/ptt/start", post(ptt_start))
        .route("/v1/ptt/stop", post(ptt_stop))
        .route("/v1/poke", post(poke))
        .route("/v1/stream", get(stream))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(st)
}
