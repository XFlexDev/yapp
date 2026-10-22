mod api;
mod converter;
mod db;
mod hub;
mod replica;
mod storage;
mod util;

use dashmap::DashMap;
use parking_lot::{Mutex, MutexGuard};
use rusqlite::Connection;
use std::{sync::Arc, time::Instant};

pub struct AppState {
    db: Mutex<Connection>,
    pub cfg: util::Config,
    pub hub: hub::Hub,
    pub http: reqwest::Client,
    pub pokes: DashMap<(String, String), Instant>,
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
    });
    let listener = tokio::net::TcpListener::bind(&bind).await.expect("bind");
    tracing::info!("yap-server listening on {bind}");
    tokio::spawn(replica::run(state.clone()));
    axum::serve(listener, api::router(state)).await.expect("serve");
}
