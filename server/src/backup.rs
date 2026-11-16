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

/// Seconds since the epoch for the `YYYYMMDDTHHMMSSZ` slot at the end of a backup name.
fn taken_at(name: &str) -> Option<u64> {
    let slot = name.rsplit_once('-')?.1.strip_suffix("Z.bin")?;
    let (date, time) = slot.split_once('T')?;
    if date.len() != 8 || time.len() != 6 || !slot.bytes().all(|b| b.is_ascii_digit() || b == b'T') {
        return None;
    }
    let n = |text: &str, at: usize, len: usize| text[at..at + len].parse::<i64>().ok();
    let (y, m, d) = (n(date, 0, 4)?, n(date, 4, 2)?, n(date, 6, 2)?);
    let (y, m) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let days = y.div_euclid(400) * 146_097 + y.rem_euclid(400) * 365 + y.rem_euclid(400) / 4 - y.rem_euclid(400) / 100 + (153 * m + 2) / 5 + d - 1 - 719_468;
    u64::try_from(days * 86_400 + n(time, 0, 2)? * 3600 + n(time, 2, 2)? * 60 + n(time, 4, 2)?).ok()
}

/// How long to wait so backups stay `EVERY` apart, given the names already stored.
fn until_next(names: &[String], now: u64) -> Duration {
    let newest = names.iter().filter_map(|name| taken_at(name)).max();
    newest.map_or(Duration::ZERO, |at| EVERY.saturating_sub(Duration::from_secs(now.saturating_sub(at))))
}

/// One backup every six hours, counted from the newest stored one: a string of restarts or deploys
/// must not push a week of history out with copies taken minutes apart.
pub async fn run(st: Arc<AppState>) {
    if !storage::get().is_some_and(|s| s.encryption_enabled()) {
        tracing::warn!("database backups disabled (B2 storage or YAP_MEDIA_KEY unset)");
        return;
    }
    tokio::time::sleep(Duration::from_secs(120)).await;
    if let Some(store) = storage::get() {
        match store.backup_versions().await {
            Ok(versions) => {
                let names: Vec<String> = versions.into_iter().map(|(name, _)| name).collect();
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
                tokio::time::sleep(until_next(&names, now)).await;
            }
            Err(error) => tracing::warn!(error = %error, "stored backups not listed, taking one now"),
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn name(slot: &str) -> String {
        format!("backup/45f2edb3e7af811c8ae73738-{slot}.bin")
    }

    #[test]
    fn slot_reads_back_as_the_time_it_was_written() {
        assert_eq!(taken_at(&name("19700101T000000Z")), Some(0));
        assert_eq!(taken_at(&name("20000229T120000Z")), Some(951_825_600));
        assert_eq!(taken_at(&name("20261116T202244Z")), Some(1_794_860_564));
        assert_eq!(taken_at(&name("20261231T235959Z")), Some(1_798_761_599));
        assert_eq!(taken_at("backup/other.bin"), None);
        assert_eq!(taken_at(&name("2026111xT202244Z")), None);
    }

    #[test]
    fn restarts_wait_for_the_newest_backup_to_age() {
        let at = taken_at(&name("20261116T202244Z")).unwrap();
        let stored = vec![name("20261116T201003Z"), name("20261116T202244Z"), "backup/unreadable.bin".to_string()];
        assert_eq!(until_next(&stored, at + 600), EVERY - Duration::from_secs(600));
        assert_eq!(until_next(&stored, at + 7 * 3600), Duration::ZERO);
        assert_eq!(until_next(&stored, at - 60), EVERY);
        assert_eq!(until_next(&[], at), Duration::ZERO);
    }
}
