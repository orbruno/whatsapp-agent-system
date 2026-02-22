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

function runMigrations(db: Database.Database): void {
  const migrations = [
    // Messages table additions
    'ALTER TABLE messages ADD COLUMN media_local_path TEXT',
    'ALTER TABLE messages ADD COLUMN mentions TEXT',
    'ALTER TABLE messages ADD COLUMN quoted_message_id TEXT',
    'ALTER TABLE messages ADD COLUMN quoted_content TEXT',
    'ALTER TABLE messages ADD COLUMN forward_score INTEGER',
    'ALTER TABLE messages ADD COLUMN has_url_preview INTEGER DEFAULT 0',
    'ALTER TABLE messages ADD COLUMN url_preview_title TEXT',
    'ALTER TABLE messages ADD COLUMN url_preview_description TEXT',
    'ALTER TABLE messages ADD COLUMN url_preview_url TEXT',
    'ALTER TABLE messages ADD COLUMN edited_at TEXT',
    'ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0',

    // Contacts table additions
    'ALTER TABLE contacts ADD COLUMN about TEXT',
    'ALTER TABLE contacts ADD COLUMN profile_picture_url TEXT',
    'ALTER TABLE contacts ADD COLUMN is_business INTEGER DEFAULT 0',
    'ALTER TABLE contacts ADD COLUMN business_name TEXT',
    'ALTER TABLE contacts ADD COLUMN business_description TEXT',
    'ALTER TABLE contacts ADD COLUMN business_category TEXT',
    'ALTER TABLE contacts ADD COLUMN business_website TEXT',
    'ALTER TABLE contacts ADD COLUMN verified_name TEXT',
    'ALTER TABLE contacts ADD COLUMN updated_at TEXT',

    // Chats table additions
    'ALTER TABLE chats ADD COLUMN description TEXT',
    'ALTER TABLE chats ADD COLUMN subject TEXT',
    'ALTER TABLE chats ADD COLUMN subject_owner TEXT',
    'ALTER TABLE chats ADD COLUMN subject_time TEXT',
    'ALTER TABLE chats ADD COLUMN description_owner TEXT',
    'ALTER TABLE chats ADD COLUMN description_time TEXT',
    'ALTER TABLE chats ADD COLUMN creation_time TEXT',
    'ALTER TABLE chats ADD COLUMN created_by TEXT',
    'ALTER TABLE chats ADD COLUMN restrict INTEGER',
    'ALTER TABLE chats ADD COLUMN announce INTEGER',
    'ALTER TABLE chats ADD COLUMN profile_picture_url TEXT',
    'ALTER TABLE chats ADD COLUMN is_archived INTEGER DEFAULT 0',
    'ALTER TABLE chats ADD COLUMN is_pinned INTEGER DEFAULT 0',
    'ALTER TABLE chats ADD COLUMN is_muted INTEGER DEFAULT 0',
    'ALTER TABLE chats ADD COLUMN updated_at TEXT',
  ]

  for (const sql of migrations) {
    try {
      db.exec(sql)
    } catch {
      // Column already exists - ignore
    }
  }

  // New tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_participants (
      chat_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      added_at TEXT,
      added_by TEXT,
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      is_active INTEGER DEFAULT 1,
      PRIMARY KEY (chat_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      reaction TEXT NOT NULL,
      timestamp TEXT,
      PRIMARY KEY (message_id, contact_id)
    );
  `)
}

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  db.exec(SCHEMA)
  db.exec(FTS_TRIGGERS)
  runMigrations(db)

  return db
}

export function prepareStatements(db: Database.Database): Statements {
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages
    (id, chat_id, contact_id, source, origin, direction, message_type, content,
     timestamp, sender_name, reply_to_id, is_forwarded,
     media_mime_type, media_size_bytes, media_filename, media_duration_seconds, raw_json,
     mentions, quoted_message_id, quoted_content, forward_score,
     has_url_preview, url_preview_title, url_preview_description, url_preview_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  const upsertChatMetadata = db.prepare(`
    UPDATE chats SET description=?, subject=?, subject_owner=?, subject_time=?,
    description_owner=?, description_time=?, creation_time=?, created_by=?,
    restrict=?, announce=?, profile_picture_url=?, updated_at=datetime('now')
    WHERE id=?
  `)

  const updateChatFlags = db.prepare(`
    UPDATE chats SET is_archived=?, is_pinned=?, is_muted=?, updated_at=datetime('now')
    WHERE id=?
  `)

  const upsertContactMetadata = db.prepare(`
    UPDATE contacts SET about=?, profile_picture_url=?, is_business=?,
    business_name=?, verified_name=?, updated_at=datetime('now')
    WHERE id=?
  `)

  const upsertParticipant = db.prepare(`
    INSERT OR REPLACE INTO chat_participants
    (chat_id, contact_id, role, added_at, added_by, last_seen, is_active)
    VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
  `)

  const deactivateParticipant = db.prepare(`
    UPDATE chat_participants SET is_active=0, last_seen=datetime('now')
    WHERE chat_id=? AND contact_id=?
  `)

  const updateParticipantRole = db.prepare(`
    UPDATE chat_participants SET role=?, last_seen=datetime('now')
    WHERE chat_id=? AND contact_id=?
  `)

  const upsertReaction = db.prepare(`
    INSERT OR REPLACE INTO message_reactions
    (message_id, contact_id, reaction, timestamp)
    VALUES (?, ?, ?, ?)
  `)

  const updateMessageEdited = db.prepare(`
    UPDATE messages SET edited_at=?, content=? WHERE id=?
  `)

  const updateMessageDeleted = db.prepare(`
    UPDATE messages SET is_deleted=1 WHERE id=?
  `)

  return {
    insertMessage,
    insertChat,
    insertContact,
    logSync,
    updateChatMessageCount,
    updateMediaPath,
    getMediaPendingMessages,
    upsertChatMetadata,
    updateChatFlags,
    upsertContactMetadata,
    upsertParticipant,
    deactivateParticipant,
    updateParticipantRole,
    upsertReaction,
    updateMessageEdited,
    updateMessageDeleted,
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
  readonly upsertChatMetadata: Database.Statement
  readonly updateChatFlags: Database.Statement
  readonly upsertContactMetadata: Database.Statement
  readonly upsertParticipant: Database.Statement
  readonly deactivateParticipant: Database.Statement
  readonly updateParticipantRole: Database.Statement
  readonly upsertReaction: Database.Statement
  readonly updateMessageEdited: Database.Statement
  readonly updateMessageDeleted: Database.Statement
}
