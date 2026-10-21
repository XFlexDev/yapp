//! Write-behind replica: the local SQLite stays primary; triggers copy every change of the
//! durable tables into `outbox` in the same transaction, and a worker ships it to KreatixDB.

use crate::AppState;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::{sync::Arc, time::Duration};

const TABLES: &[&str] = &["users", "friendships", "friend_requests", "devices", "messages", "chat_meta", "chat_reads", "groups", "group_members",
    "notif_prefs",
    "mutes"];

struct Col {
    name: String,
    ty: String,
    pk: i64,
}

fn columns(c: &Connection, t: &str) -> rusqlite::Result<Vec<Col>> {
    let mut s = c.prepare(&format!("SELECT name, type, pk FROM pragma_table_info('{t}')"))?;
    let v = s.query_map([], |r| Ok(Col { name: r.get(0)?, ty: r.get(1)?, pk: r.get(2)? }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

fn keys(cols: &[Col]) -> Vec<&Col> {
    let mut k: Vec<&Col> = cols.iter().filter(|c| c.pk > 0).collect();
    k.sort_by_key(|c| c.pk);
    if k.is_empty() { cols.iter().collect() } else { k }
}

fn obj(cols: &[&Col], prefix: &str) -> String {
    let parts: Vec<String> = cols.iter().map(|c| format!("'{n}', {prefix}\"{n}\"", n = c.name)).collect();
    format!("json_object({})", parts.join(", "))
}

pub fn install(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, op TEXT NOT NULL, row TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS replica_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);",
    )?;
    let tx = c.unchecked_transaction()?;
    for t in TABLES {
        let cols = columns(&tx, t)?;
        let all: Vec<&Col> = cols.iter().collect();
        let k = keys(&cols);
        let (new, oldk) = (obj(&all, "NEW."), obj(&k, "OLD."));
        tx.execute_batch(&format!(
            "DROP TRIGGER IF EXISTS rep_{t}_i; DROP TRIGGER IF EXISTS rep_{t}_u; DROP TRIGGER IF EXISTS rep_{t}_d;
             CREATE TRIGGER rep_{t}_i AFTER INSERT ON {t} BEGIN INSERT INTO outbox(tbl, op, row) VALUES ('{t}', 'upsert', {new}); END;
             CREATE TRIGGER rep_{t}_u AFTER UPDATE ON {t} BEGIN
               INSERT INTO outbox(tbl, op, row) VALUES ('{t}', 'delete', {oldk});
               INSERT INTO outbox(tbl, op, row) VALUES ('{t}', 'upsert', {new});
             END;
             CREATE TRIGGER rep_{t}_d AFTER DELETE ON {t} BEGIN INSERT INTO outbox(tbl, op, row) VALUES ('{t}', 'delete', {oldk}); END;"
        ))?;
    }
    let seeded = tx.query_row("SELECT 1 FROM replica_meta WHERE k='seeded'", [], |_| Ok(())).optional()?.is_some();
    if !seeded {
        for t in TABLES {
            let cols = columns(&tx, t)?;
            let all: Vec<&Col> = cols.iter().collect();
            tx.execute(&format!("INSERT INTO outbox(tbl, op, row) SELECT '{t}', 'upsert', {} FROM {t}", obj(&all, "")), [])?;
        }
        tx.execute("INSERT INTO replica_meta(k, v) VALUES ('seeded', '1')", [])?;
    }
    tx.commit()
}

fn statement(st: &AppState, tbl: &str, op: &str, row: &str) -> Option<Value> {
    let m: Map<String, Value> = serde_json::from_str(row).ok()?;
    let names: Vec<&String> = m.keys().collect();
    let params: Vec<&Value> = m.values().collect();
    let q = |n: &String| format!("\"{n}\"");
    let sql = if op == "upsert" {
        let marks = vec!["?"; names.len()].join(", ");
        format!("INSERT OR REPLACE INTO \"{tbl}\" ({}) VALUES ({marks})", names.iter().map(|n| q(n)).collect::<Vec<_>>().join(", "))
    } else {
        format!("DELETE FROM \"{tbl}\" WHERE {}", names.iter().map(|n| format!("{} IS ?", q(n))).collect::<Vec<_>>().join(" AND "))
    };
    let _ = st;
    Some(json!({ "sql": sql, "params": params }))
}

enum Fail {
    Retry(String),
    Bad(String),
}

async fn post(http: &reqwest::Client, url: &str, key: &str, body: &Value) -> Result<Value, Fail> {
    let r = http.post(url).bearer_auth(key).json(body).send().await.map_err(|e| Fail::Retry(e.to_string()))?;
    let status = r.status();
    let text = r.text().await.unwrap_or_default();
    if status.is_success() {
        return Ok(serde_json::from_str(&text).unwrap_or(Value::Null));
    }
    let msg = format!("{status}: {}", text.chars().take(300).collect::<String>());
    if status.as_u16() == 400 || status.as_u16() == 422 { Err(Fail::Bad(msg)) } else { Err(Fail::Retry(msg)) }
}

fn first_column(v: &Value) -> Vec<String> {
    let rows = v["results"][0]["rows"].as_array().cloned().unwrap_or_default();
    rows.iter()
        .filter_map(|r| r.as_array().and_then(|a| a.first().cloned()).or_else(|| r.get("name").cloned()))
        .filter_map(|x| x.as_str().map(str::to_string))
        .collect()
}

async fn ensure_schema(st: &AppState, http: &reqwest::Client, url: &str, key: &str) -> Result<(), String> {
    let specs: Vec<(String, Vec<(String, String)>, Vec<String>)> = {
        let c = st.db();
        let mut v = Vec::new();
        for t in TABLES {
            let cols = columns(&c, t).map_err(|e| e.to_string())?;
            let pk: Vec<String> = cols.iter().filter(|c| c.pk > 0).map(|c| c.name.clone()).collect();
            v.push((t.to_string(), cols.iter().map(|c| (c.name.clone(), if c.ty.is_empty() { "TEXT".into() } else { c.ty.clone() })).collect(), pk));
        }
        v
    };
    let err = |f: Fail| match f { Fail::Retry(m) | Fail::Bad(m) => m };
    for (t, cols, pk) in specs {
        let mut defs: Vec<String> = cols.iter().map(|(n, ty)| format!("\"{n}\" {ty}")).collect();
        if !pk.is_empty() {
            defs.push(format!("PRIMARY KEY({})", pk.iter().map(|n| format!("\"{n}\"")).collect::<Vec<_>>().join(", ")));
        }
        let create = json!({ "sql": format!("CREATE TABLE IF NOT EXISTS \"{t}\" ({})", defs.join(", ")), "params": [] });
        post(http, &format!("{url}/query"), key, &create).await.map_err(err)?;
        let have = first_column(&post(http, &format!("{url}/query"), key, &json!({ "sql": format!("SELECT name FROM pragma_table_info('{t}')"), "params": [] })).await.map_err(err)?);
        for (n, ty) in cols.iter().filter(|(n, _)| !have.contains(n)) {
            post(http, &format!("{url}/query"), key, &json!({ "sql": format!("ALTER TABLE \"{t}\" ADD COLUMN \"{n}\" {ty}"), "params": [] })).await.map_err(err)?;
        }
    }
    Ok(())
}

pub async fn run(st: Arc<AppState>) {
    let (Ok(url), Ok(key)) = (std::env::var("YAP_KDB_URL"), std::env::var("YAP_KDB_KEY")) else {
        tracing::warn!("KreatixDB replica disabled (YAP_KDB_URL/YAP_KDB_KEY unset)");
        return;
    };
    let http = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().expect("http client");
    let (mut ready, mut backoff) = (false, 1u64);
    let pause = |s: u64| tokio::time::sleep(Duration::from_secs(s));
    loop {
        if !ready {
            match ensure_schema(&st, &http, &url, &key).await {
                Ok(()) => { ready = true; backoff = 1; tracing::info!("KreatixDB replica schema ready"); }
                Err(e) => { tracing::warn!(error = %e, "KreatixDB schema"); pause(backoff).await; backoff = (backoff * 2).min(60); continue; }
            }
        }
        let batch: Vec<(i64, Value)> = {
            let c = st.db();
            let rows: Vec<(i64, String, String, String)> = match c.prepare("SELECT seq, tbl, op, row FROM outbox ORDER BY seq LIMIT 50") {
                Ok(mut s) => s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).and_then(|m| m.collect()).unwrap_or_default(),
                Err(_) => Vec::new(),
            };
            rows.iter().filter_map(|(seq, t, op, row)| statement(&st, t, op, row).map(|s| (*seq, s))).collect()
        };
        if batch.is_empty() {
            tokio::time::sleep(Duration::from_millis(400)).await;
            continue;
        }
        let last = batch.last().map(|b| b.0).unwrap_or(0);
        let body = json!({ "statements": batch.iter().map(|b| &b.1).collect::<Vec<_>>() });
        match post(&http, &format!("{url}/batch"), &key, &body).await {
            Ok(_) => {
                let _ = st.db().execute("DELETE FROM outbox WHERE seq<=?", [last]);
                backoff = 1;
            }
            Err(Fail::Bad(m)) => {
                // One bad statement must not block the queue: replay one by one and drop only the offender.
                tracing::warn!(error = %m, "KreatixDB batch rejected, replaying singly");
                for (seq, s) in &batch {
                    match post(&http, &format!("{url}/query"), &key, s).await {
                        Ok(_) => {}
                        Err(Fail::Bad(e)) => tracing::error!(seq, error = %e, sql = %s["sql"], "KreatixDB dropped statement"),
                        Err(Fail::Retry(e)) => { tracing::warn!(error = %e, "KreatixDB unreachable"); break; }
                    }
                    let _ = st.db().execute("DELETE FROM outbox WHERE seq<=?", [seq]);
                }
            }
            Err(Fail::Retry(m)) => {
                tracing::warn!(error = %m, backoff, "KreatixDB unreachable, retrying");
                pause(backoff).await;
                backoff = (backoff * 2).min(60);
            }
        }
    }
}
