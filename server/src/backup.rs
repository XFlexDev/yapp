//! Database backups: a consistent copy of the SQLite file, encrypted with the media key and stored in B2.
//! Nothing on the server survives a reinstall, so this is the only copy of accounts and chats that does.
//!
//! `yap-server backups` lists them, `yap-server backup-now` takes one, and
//! `yap-server restore-backup <name|latest> <out.sqlite3>` writes one to a new file.
//! Reading a backup needs the same YAP_MEDIA_KEY and storage key that made it, so keep a copy of
//! /etc/yap.env somewhere that is not this server.

use crate::{storage, AppState};
use rusqlite::Connection;
use std::{sync::Arc, time::Duration};

const EVERY: Duration = Duration::from_secs(6 * 3600);
/// A week of backups at four a day.
const KEEP: usize = 28;

/// Copy the live database to a temporary file over its own connection, so the server keeps answering.
fn snapshot(db_path: &str) -> Result<Vec<u8>, String> {
    let tmp = format!("{db_path}.backup-tmp");
    let _ = std::fs::remove_file(&tmp);
    let c = Connection::open(db_path).map_err(|e| e.to_string())?;
    c.busy_timeout(Duration::from_secs(30)).map_err(|e| e.to_string())?;
    let copied = c.execute("VACUUM INTO ?1", [&tmp]).map_err(|e| e.to_string());
    let bytes = copied.and_then(|_| std::fs::read(&tmp).map_err(|e| e.to_string()));
    let _ = std::fs::remove_file(&tmp);
    bytes
}

pub async fn take(db_path: &str) -> Result<(String, usize), String> {
    let store = storage::get().ok_or_else(|| "B2 storage is not configured".to_string())?;
    let name = store.backup_name(&storage::stamp().1)?;
    let path = db_path.to_string();
    let bytes = tokio::task::spawn_blocking(move || snapshot(&path)).await.map_err(|e| e.to_string())??;
    store.put_backup(&name, &bytes).await?;
    Ok((name, bytes.len()))
}

/// Delete every version of all but the newest `keep` backups. Returns how many backups were removed.
pub async fn prune(keep: usize) -> Result<usize, String> {
    let store = storage::get().ok_or_else(|| "B2 storage is not configured".to_string())?;
    let versions = store.backup_versions().await?;
    let mut names: Vec<&String> = versions.iter().map(|(name, _)| name).collect();
    names.dedup();
    let drop = names.len().saturating_sub(keep);
    let old: std::collections::HashSet<&String> = names.into_iter().take(drop).collect();
    for (name, version) in versions.iter().filter(|(name, _)| old.contains(name)) {
        store.delete_backup(name, version).await?;
    }
    Ok(drop)
}

/// One backup shortly after every start, then one every six hours.
pub async fn run(st: Arc<AppState>) {
    if !storage::get().is_some_and(|s| s.encryption_enabled()) {
        tracing::warn!("database backups disabled (B2 storage or YAP_MEDIA_KEY unset)");
        return;
    }
    tokio::time::sleep(Duration::from_secs(120)).await;
    loop {
        match take(&st.cfg.db_path).await {
            Ok((name, bytes)) => {
                tracing::info!(name, bytes, "database backup stored");
                if let Err(error) = prune(KEEP).await {
                    tracing::warn!(error = %error, "old backups not pruned");
                }
                tokio::time::sleep(EVERY).await;
            }
            Err(error) => {
                tracing::error!(error = %error, "database backup failed");
                tokio::time::sleep(Duration::from_secs(900)).await;
            }
        }
    }
}

/// `yap-server backup-now | backups | prune-backups <keep> | restore-backup <name|latest> <out>`.
pub async fn cli(command: &str, args: &[String], db_path: &str) -> Result<(), String> {
    let store = storage::get().ok_or_else(|| "B2 storage is not configured".to_string())?;
    let names = || async {
        let mut names: Vec<String> = store.backup_versions().await?.into_iter().map(|(name, _)| name).collect();
        names.dedup();
        Ok::<_, String>(names)
    };
    match command {
        "backup-now" => {
            let (name, bytes) = take(db_path).await?;
            println!("stored {name} ({bytes} bytes)");
        }
        "backups" => {
            for name in names().await? {
                println!("{name}");
            }
        }
        "prune-backups" => {
            let keep: usize = args.first().and_then(|n| n.parse().ok()).filter(|n| *n > 0).ok_or("usage: yap-server prune-backups <how many to keep>")?;
            println!("removed {} old backups", prune(keep).await?);
        }
        _ => {
            let (Some(which), Some(out)) = (args.first(), args.get(1)) else {
                return Err("usage: yap-server restore-backup <name|latest> <out.sqlite3>".into());
            };
            if std::path::Path::new(out).exists() {
                return Err(format!("{out} already exists; restore never overwrites a file"));
            }
            let name = if which == "latest" { names().await?.pop().ok_or_else(|| "no backups found".to_string())? } else { which.clone() };
            let bytes = store.get_backup(&name).await?;
            std::fs::write(out, &bytes).map_err(|e| e.to_string())?;
            println!("wrote {name} to {out} ({} bytes)", bytes.len());
        }
    }
    Ok(())
}
