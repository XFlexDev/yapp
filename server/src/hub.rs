use dashmap::DashMap;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::mpsc::UnboundedSender;

#[derive(Default)]
pub struct Hub {
    conns: DashMap<String, Vec<(u64, UnboundedSender<String>)>>,
    next: AtomicU64,
}

impl Hub {
    /// Returns the connection id and whether this is the user's first live connection.
    pub fn register(&self, user: &str, tx: UnboundedSender<String>) -> (u64, bool) {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let mut e = self.conns.entry(user.to_string()).or_default();
        let first = e.is_empty();
        e.push((id, tx));
        (id, first)
    }

    /// Returns true when the user has no live connections left.
    pub fn unregister(&self, user: &str, id: u64) -> bool {
        let mut last = false;
        if let Some(mut e) = self.conns.get_mut(user) {
            e.retain(|(i, _)| *i != id);
            last = e.is_empty();
        }
        if last {
            self.conns.remove_if(user, |_, v| v.is_empty());
        }
        last
    }

    pub fn online(&self, user: &str) -> bool {
        self.conns.get(user).is_some_and(|v| !v.is_empty())
    }

    pub fn send(&self, user: &str, ev: &Value) {
        if let Some(v) = self.conns.get(user) {
            let s = ev.to_string();
            for (_, tx) in v.iter() {
                let _ = tx.send(s.clone());
            }
        }
    }
}
