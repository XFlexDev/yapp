use rusqlite::Connection;

pub fn open(path: &str) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch(
        r#"
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        PRAGMA busy_timeout=5000;
        PRAGMA synchronous=NORMAL;
        PRAGMA temp_store=MEMORY;
        PRAGMA cache_size=-32768;
        PRAGMA mmap_size=268435456;
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
        CREATE TABLE IF NOT EXISTS streaks(
            a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            a_day INTEGER NOT NULL DEFAULT 0,
            b_day INTEGER NOT NULL DEFAULT 0,
            day INTEGER NOT NULL DEFAULT 0,
            current INTEGER NOT NULL DEFAULT 0,
            longest INTEGER NOT NULL DEFAULT 0,
            last_talked INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(a, b)
        );
        CREATE TABLE IF NOT EXISTS friend_order(
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            pos INTEGER NOT NULL,
            PRIMARY KEY(user_id, friend_id)
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
        CREATE TABLE IF NOT EXISTS chat_clears(
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            at INTEGER NOT NULL,
            PRIMARY KEY(user_id, friend_id)
        );
        CREATE TABLE IF NOT EXISTS media_meta(
            key TEXT PRIMARY KEY,
            w INTEGER NOT NULL,
            h INTEGER NOT NULL,
            thumb TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS group_invites(
            group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            PRIMARY KEY(group_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS group_invites_user ON group_invites(user_id);
        CREATE TABLE IF NOT EXISTS group_members(
            group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at INTEGER NOT NULL,
            read_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(group_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS notif_prefs(
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            messages INTEGER NOT NULL DEFAULT 1,
            talk INTEGER NOT NULL DEFAULT 1,
            calls INTEGER NOT NULL DEFAULT 1,
            friends INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS mutes(
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            chat TEXT NOT NULL,
            PRIMARY KEY(user_id, chat)
        );
        CREATE TABLE IF NOT EXISTS blocks(
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            PRIMARY KEY(user_id, blocked_id)
        );
        CREATE TABLE IF NOT EXISTS banned_emails(
            email TEXT PRIMARY KEY,
            reason TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reports(
            id TEXT PRIMARY KEY,
            reporter_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            message_id TEXT,
            group_id TEXT,
            snapshot TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS stats(
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            talks INTEGER NOT NULL DEFAULT 0,
            calls INTEGER NOT NULL DEFAULT 0,
            pokes INTEGER NOT NULL DEFAULT 0,
            group_talks INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS clips(
            id TEXT PRIMARY KEY,
            from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            ms INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS clips_to ON clips(to_id, created_at);
        CREATE TABLE IF NOT EXISTS chat_reads(
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            friend_id TEXT NOT NULL,
            read_at INTEGER NOT NULL,
            PRIMARY KEY(user_id, friend_id)
        );
        CREATE TABLE IF NOT EXISTS stickers(
            id TEXT PRIMARY KEY,
            hash TEXT NOT NULL UNIQUE,
            mime TEXT NOT NULL,
            is_animated INTEGER NOT NULL DEFAULT 0,
            is_emoji INTEGER NOT NULL DEFAULT 0,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sticker_packs(
            id TEXT PRIMARY KEY,
            slug TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            is_emoji_pack INTEGER NOT NULL DEFAULT 0,
            thumbnail_id TEXT REFERENCES stickers(id) ON DELETE SET NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sticker_pack_items(
            pack_id TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
            sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            alt_emoji TEXT NOT NULL DEFAULT '',
            PRIMARY KEY(pack_id, sticker_id)
        );
        CREATE INDEX IF NOT EXISTS sticker_pack_items_pack ON sticker_pack_items(pack_id, position);
        CREATE TABLE IF NOT EXISTS user_installed_packs(
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            pack_id TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            installed_at INTEGER NOT NULL,
            PRIMARY KEY(user_id, pack_id)
        );
        CREATE TABLE IF NOT EXISTS user_recent_stickers(
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
            used_at INTEGER NOT NULL,
            PRIMARY KEY(user_id, sticker_id)
        );
        "#,
    )?;
    Ok(c)
}

pub fn pair<'a>(x: &'a str, y: &'a str) -> (&'a str, &'a str) {
    if x < y { (x, y) } else { (y, x) }
}
