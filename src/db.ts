import Database from 'better-sqlite3'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    phone TEXT,
    display_name TEXT,
    push_name TEXT,
    source TEXT NOT NULL DEFAULT 'personal',
    first_seen INTEGER,
    last_seen INTEGER,
    message_count INTEGER DEFAULT 0,
    raw_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    chat_type TEXT NOT NULL,
    chat_name TEXT,
    source TEXT NOT NULL DEFAULT 'personal',
    participant_count INTEGER DEFAULT 2,
    total_messages INTEGER DEFAULT 0,
    first_message_at INTEGER,
    last_message_at INTEGER,
    raw_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chats_source ON chats(source);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    contact_id TEXT,
    source TEXT NOT NULL DEFAULT 'personal',
    origin TEXT NOT NULL DEFAULT 'live_capture',
    direction TEXT NOT NULL,
    message_type TEXT NOT NULL,
    content TEXT,
    timestamp INTEGER NOT NULL,
    sender_name TEXT,
    reply_to_id TEXT,
    is_forwarded INTEGER DEFAULT 0,
    media_mime_type TEXT,
    media_size_bytes INTEGER,
    media_filename TEXT,
    media_duration_seconds REAL,
    raw_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source);
  CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
  CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);

  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content=messages,
    content_rowid=rowid
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT NOT NULL,
    messages_count INTEGER DEFAULT 0,
    chats_count INTEGER DEFAULT 0,
    contacts_count INTEGER DEFAULT 0,
    progress INTEGER,
    is_latest INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
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

  try {
    db.exec('ALTER TABLE messages ADD COLUMN media_local_path TEXT')
  } catch {
    // Column already exists - ignore
  }

  return db
}

export function prepareStatements(db: Database.Database): Statements {
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages
    (id, chat_id, contact_id, source, origin, direction, message_type, content,
     timestamp, sender_name, reply_to_id, is_forwarded,
     media_mime_type, media_size_bytes, media_filename, media_duration_seconds, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertChat = db.prepare(`
    INSERT OR REPLACE INTO chats
    (id, chat_type, chat_name, source, participant_count, total_messages,
     first_message_at, last_message_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertContact = db.prepare(`
    INSERT OR REPLACE INTO contacts
    (id, phone, display_name, push_name, source, first_seen, last_seen, message_count, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const logSync = db.prepare(`
    INSERT INTO sync_log (sync_type, messages_count, chats_count, contacts_count, progress, is_latest)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const updateChatMessageCount = db.prepare(`
    UPDATE chats
    SET total_messages = (SELECT COUNT(*) FROM messages WHERE chat_id = ?),
        first_message_at = (SELECT MIN(timestamp) FROM messages WHERE chat_id = ?),
        last_message_at = (SELECT MAX(timestamp) FROM messages WHERE chat_id = ?)
    WHERE id = ?
  `)

  const updateMediaPath = db.prepare(
    'UPDATE messages SET media_local_path = ? WHERE id = ?'
  )

  const getMediaPendingMessages = db.prepare(`
    SELECT id, chat_id, raw_json FROM messages
    WHERE media_mime_type IS NOT NULL AND media_local_path IS NULL
    ORDER BY timestamp DESC
  `)

  return {
    insertMessage,
    insertChat,
    insertContact,
    logSync,
    updateChatMessageCount,
    updateMediaPath,
    getMediaPendingMessages,
  }
}

export interface Statements {
  readonly insertMessage: Database.Statement
  readonly insertChat: Database.Statement
  readonly insertContact: Database.Statement
  readonly logSync: Database.Statement
  readonly updateChatMessageCount: Database.Statement
  readonly updateMediaPath: Database.Statement
  readonly getMediaPendingMessages: Database.Statement
}
