mod api;
mod converter;
mod db;
mod hub;
mod moderation;
mod replica;
mod storage;
mod util;

use dashmap::DashMap;
use parking_lot::{Mutex, MutexGuard};
use rusqlite::Connection;
use std::{
    collections::HashSet,
    sync::{
        atomic::AtomicUsize,
        Arc,
    },
    time::Instant,
};

pub struct AppState {
    db: Mutex<Connection>,
    pub cfg: util::Config,
    pub hub: hub::Hub,
    pub http: reqwest::Client,
    pub pokes: DashMap<(String, String), Instant>,
    pub waves: DashMap<(String, String), Instant>,
    pub sticker_uploads: DashMap<String, Vec<Instant>>,
    pub media_cache: DashMap<String, (axum::body::Bytes, &'static str, Instant)>,
    pub media_cache_bytes: AtomicUsize,
}

impl AppState {
    pub fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock()
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    if std::env::args().nth(1).as_deref() == Some("encrypt-media") {
        if let Err(error) = load_service_env("/etc/yap.env") {
            tracing::warn!(error = %error, "could not load /etc/yap.env; using process environment");
        }
        let db_path = std::env::var("YAP_DB").unwrap_or_else(|_| "yap.sqlite3".into());
        if let Err(error) = encrypt_media(&db_path).await {
            eprintln!("encrypt-media failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    let cfg = util::Config::from_env();
    let conn = db::open(&cfg.db_path).expect("open database");
    replica::install(&conn).expect("install replica triggers");
    let bind = cfg.bind.clone();
    let state = Arc::new(AppState {
        db: Mutex::new(conn),
        cfg,
        hub: hub::Hub::default(),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("http client"),
        pokes: DashMap::new(),
        waves: DashMap::new(),
        sticker_uploads: DashMap::new(),
        media_cache: DashMap::new(),
        media_cache_bytes: AtomicUsize::new(0),
    });
    let listener = tokio::net::TcpListener::bind(&bind).await.expect("bind");
    tracing::info!("yap-server listening on {bind}");
    tokio::spawn(replica::run(state.clone()));
    tokio::spawn(api::backfill_stickers(state.clone()));
    axum::serve(listener, api::router(state)).await.expect("serve");
}

fn load_service_env(path: &str) -> std::io::Result<()> {
    let raw = std::fs::read_to_string(path)?;
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else { continue };
        let key = key.trim();
        if key.is_empty() || std::env::var_os(key).is_some() {
            continue;
        }
        let value = value.trim().trim_matches('"').trim_matches('\'');
        std::env::set_var(key, value);
    }
    Ok(())
}

async fn encrypt_media(db_path: &str) -> Result<(), String> {
    let store = storage::get().ok_or_else(|| "B2 storage is not configured".to_string())?;
    if !store.encryption_enabled() {
        return Err("YAP_MEDIA_KEY must be a valid 64-character hex key".into());
    }
    let conn = db::open(db_path).map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT avatar FROM users WHERE avatar IS NOT NULL
             UNION SELECT pfp FROM users WHERE pfp IS NOT NULL
             UNION SELECT body FROM messages
             UNION SELECT background FROM chat_meta WHERE background IS NOT NULL
             UNION SELECT key FROM media_meta
             UNION SELECT thumb FROM media_meta
             UNION SELECT background FROM groups WHERE background IS NOT NULL
             UNION SELECT id FROM stickers
             UNION SELECT thumbnail_id FROM sticker_packs WHERE thumbnail_id IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let keys: HashSet<String> = rows.into_iter().filter(|key| storage::valid_media_key(key)).collect();
    println!("found {} referenced media keys", keys.len());

    let mut encrypted = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    for (index, key) in keys.iter().enumerate() {
        let result = async {
            if store.encrypted_exists(key).await? {
                store.purge_encrypted(key).await?;
                store.delete_plain(key).await;
                return Ok::<bool, String>(false);
            }
            let Some((plaintext, content_type)) = store.get_plain(key).await? else {
                return Err("plaintext object not found".into());
            };
            store.put(key, plaintext, content_type).await?;
            store.purge_encrypted(key).await?;
            store.delete_plain(key).await;
            Ok(true)
        }
        .await;
        match result {
            Ok(true) => encrypted += 1,
            Ok(false) => skipped += 1,
            Err(error) => {
                failed += 1;
                eprintln!("[{}/{}] failed {key}: {error}", index + 1, keys.len());
                continue;
            }
        }
        println!("[{}/{}] {key}", index + 1, keys.len());
    }
    println!(
        "encrypt-media complete: {} encrypted, {} already encrypted, {} failed",
        encrypted, skipped, failed
    );
    Ok(())
}
