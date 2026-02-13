import Database from 'better-sqlite3'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT NOT NULL DEFAULT 'channel',
    topic TEXT,
    purpose TEXT,
    member_count INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0,
    created_at INTEGER,
    last_message_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(type);
  CREATE INDEX IF NOT EXISTS idx_channels_name ON channels(name);

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    display_name TEXT,
    real_name TEXT,
    email TEXT,
    is_bot INTEGER DEFAULT 0,
    first_seen INTEGER,
    last_seen INTEGER,
    raw_json TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT,
    content TEXT,
    timestamp REAL NOT NULL,
    thread_ts TEXT,
    message_type TEXT NOT NULL DEFAULT 'message',
    subtype TEXT,
    is_edited INTEGER DEFAULT 0,
    has_files INTEGER DEFAULT 0,
    file_urls TEXT,
    raw_json TEXT,
    PRIMARY KEY (id, channel_id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_ts);

  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content=messages,
    content_rowid=rowid
  );
`

const FTS_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
      VALUES ('delete', old.rowid, old.content);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
      VALUES ('delete', old.rowid, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
`

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  db.exec(SCHEMA)
  db.exec(FTS_TRIGGERS)

  return db
}

export function prepareStatements(db: Database.Database): Statements {
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages
    (id, channel_id, user_id, content, timestamp, thread_ts,
     message_type, subtype, is_edited, has_files, file_urls, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const upsertChannel = db.prepare(`
    INSERT INTO channels (id, name, type, topic, purpose, member_count, is_archived, created_at, last_message_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      topic = excluded.topic,
      purpose = excluded.purpose,
      member_count = excluded.member_count,
      is_archived = excluded.is_archived,
      last_message_at = COALESCE(excluded.last_message_at, channels.last_message_at)
  `)

  const upsertUser = db.prepare(`
    INSERT INTO users (id, name, display_name, real_name, email, is_bot, first_seen, last_seen, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      display_name = excluded.display_name,
      real_name = excluded.real_name,
      email = COALESCE(excluded.email, users.email),
      is_bot = excluded.is_bot,
      last_seen = excluded.last_seen,
      raw_json = excluded.raw_json
  `)

  const updateChannelLastMessage = db.prepare(`
    UPDATE channels
    SET last_message_at = ?
    WHERE id = ? AND (last_message_at IS NULL OR last_message_at < ?)
  `)

  return {
    insertMessage,
    upsertChannel,
    upsertUser,
    updateChannelLastMessage,
  }
}

export interface Statements {
  readonly insertMessage: Database.Statement
  readonly upsertChannel: Database.Statement
  readonly upsertUser: Database.Statement
  readonly updateChannelLastMessage: Database.Statement
}
