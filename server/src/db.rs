use rusqlite::Connection;

pub fn open(path: &str) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch(
        r#"
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS users(
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            username TEXT UNIQUE,
            display_name TEXT NOT NULL DEFAULT '',
            color INTEGER NOT NULL DEFAULT 0,
            dnd INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_codes(
            email TEXT PRIMARY KEY,
            code_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            sent_at INTEGER NOT NULL,
            window_start INTEGER NOT NULL,
            window_count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS refresh_tokens(
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS friendships(
            a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            PRIMARY KEY(a, b)
        );
        CREATE TABLE IF NOT EXISTS friend_requests(
            id TEXT PRIMARY KEY,
            from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            UNIQUE(from_id, to_id)
        );
        CREATE TABLE IF NOT EXISTS devices(
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            platform TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#,
    )?;
    let _ = c.execute("ALTER TABLE users ADD COLUMN avatar TEXT", []);
    let _ = c.execute("ALTER TABLE users ADD COLUMN pfp TEXT", []);
    c.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS messages(
            id TEXT PRIMARY KEY,
            a TEXT NOT NULL,
            b TEXT NOT NULL,
            sender TEXT NOT NULL,
            recipient TEXT NOT NULL,
            kind TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS messages_pair ON messages(a, b, created_at);
        CREATE TABLE IF NOT EXISTS chat_meta(
            a TEXT NOT NULL,
            b TEXT NOT NULL,
            background TEXT,
            PRIMARY KEY(a, b)
        );
        CREATE TABLE IF NOT EXISTS groups(
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            owner TEXT NOT NULL,
            background TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS group_members(
            group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at INTEGER NOT NULL,
            read_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(group_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS chat_reads(
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            friend_id TEXT NOT NULL,
            read_at INTEGER NOT NULL,
            PRIMARY KEY(user_id, friend_id)
        );
        "#,
    )?;
    Ok(c)
}

pub fn pair<'a>(x: &'a str, y: &'a str) -> (&'a str, &'a str) {
    if x < y { (x, y) } else { (y, x) }
}
