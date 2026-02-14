import type { Express, Request, Response } from 'express'
import type Database from 'better-sqlite3'
import type { SocketHolder } from './whatsapp.js'

interface CountRow {
  readonly count: number
}

interface ChatRow {
  readonly id: string
  readonly chat_type: string
  readonly chat_name: string | null
  readonly source: string
  readonly participant_count: number
  readonly total_messages: number
  readonly first_message_at: number | null
  readonly last_message_at: number | null
  readonly raw_json: string
}

interface MessageRow {
  readonly id: string
  readonly chat_id: string
  readonly contact_id: string | null
  readonly source: string
  readonly origin: string
  readonly direction: string
  readonly message_type: string
  readonly content: string | null
  readonly timestamp: number
  readonly sender_name: string | null
  readonly reply_to_id: string | null
  readonly is_forwarded: number
  readonly media_mime_type: string | null
  readonly media_size_bytes: number | null
  readonly media_filename: string | null
  readonly media_duration_seconds: number | null
  readonly media_local_path: string | null
  readonly raw_json: string
}

interface ContactRow {
  readonly id: string
  readonly phone: string | null
  readonly display_name: string | null
  readonly push_name: string | null
  readonly source: string
  readonly first_seen: number | null
  readonly last_seen: number | null
  readonly message_count: number
  readonly raw_json: string
}

interface SyncLogRow {
  readonly sync_type: string
  readonly messages_count: number
  readonly chats_count: number
  readonly contacts_count: number
  readonly progress: number | null
  readonly created_at: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function parseIntParam(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? defaultValue : parsed
}

export function createApiRoutes(app: Express, db: Database.Database, socketHolder: SocketHolder): void {
  app.get('/api/chats', (req: Request, res: Response) => {
    try {
      const limit = clamp(parseIntParam(req.query.limit as string, 50), 1, 500)
      const offset = Math.max(0, parseIntParam(req.query.offset as string, 0))
      const query = req.query.query as string | undefined

      const conditions: string[] = []
      const params: (string | number)[] = []

      if (query) {
        conditions.push('chat_name LIKE ?')
        params.push(`%${query}%`)
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const countSql = `SELECT COUNT(*) as count FROM chats ${whereClause}`
      const total = (db.prepare(countSql).get(...params) as CountRow).count

      params.push(limit, offset)
      const dataSql = `SELECT * FROM chats ${whereClause} ORDER BY last_message_at DESC LIMIT ? OFFSET ?`
      const chats = db.prepare(dataSql).all(...params) as ChatRow[]

      res.json({ data: chats, total, limit, offset })
    } catch (error) {
      res.status(500).json({ error: 'Failed to query chats' })
    }
  })

  app.get('/api/messages', (req: Request, res: Response) => {
    try {
      const limit = clamp(parseIntParam(req.query.limit as string, 50), 1, 500)
      const offset = Math.max(0, parseIntParam(req.query.offset as string, 0))
      const chatId = req.query.chat_id as string | undefined
      const query = req.query.query as string | undefined
      const direction = req.query.direction as string | undefined
      const before = req.query.before as string | undefined
      const after = req.query.after as string | undefined

      const conditions: string[] = []
      const params: (string | number)[] = []

      if (chatId) {
        conditions.push('chat_id = ?')
        params.push(chatId)
      }
      if (query) {
        conditions.push('content LIKE ?')
        params.push(`%${query}%`)
      }
      if (direction && (direction === 'incoming' || direction === 'outgoing')) {
        conditions.push('direction = ?')
        params.push(direction)
      }
      if (before) {
        const ts = parseInt(before, 10)
        if (!Number.isNaN(ts)) {
          conditions.push('timestamp < ?')
          params.push(ts)
        }
      }
      if (after) {
        const ts = parseInt(after, 10)
        if (!Number.isNaN(ts)) {
          conditions.push('timestamp > ?')
          params.push(ts)
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const countSql = `SELECT COUNT(*) as count FROM messages ${whereClause}`
      const total = (db.prepare(countSql).get(...params) as CountRow).count

      params.push(limit, offset)
      const dataSql = `SELECT * FROM messages ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      const messages = db.prepare(dataSql).all(...params) as MessageRow[]

      res.json({ data: messages, total, limit, offset })
    } catch (error) {
      res.status(500).json({ error: 'Failed to query messages' })
    }
  })

  app.get('/api/contacts', (req: Request, res: Response) => {
    try {
      const limit = clamp(parseIntParam(req.query.limit as string, 50), 1, 500)
      const offset = Math.max(0, parseIntParam(req.query.offset as string, 0))
      const query = req.query.query as string | undefined

      const conditions: string[] = []
      const params: (string | number)[] = []

      if (query) {
        conditions.push('(display_name LIKE ? OR push_name LIKE ? OR phone LIKE ?)')
        const pattern = `%${query}%`
        params.push(pattern, pattern, pattern)
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const countSql = `SELECT COUNT(*) as count FROM contacts ${whereClause}`
      const total = (db.prepare(countSql).get(...params) as CountRow).count

      params.push(limit, offset)
      const dataSql = `SELECT * FROM contacts ${whereClause} ORDER BY last_seen DESC LIMIT ? OFFSET ?`
      const contacts = db.prepare(dataSql).all(...params) as ContactRow[]

      res.json({ data: contacts, total, limit, offset })
    } catch (error) {
      res.status(500).json({ error: 'Failed to query contacts' })
    }
  })

  app.get('/api/search', (req: Request, res: Response) => {
    try {
      const q = req.query.q as string | undefined
      if (!q) {
        res.status(400).json({ error: 'Query parameter "q" is required' })
        return
      }

      const limit = clamp(parseIntParam(req.query.limit as string, 50), 1, 200)
      const chatId = req.query.chat_id as string | undefined

      let sql: string
      const params: (string | number)[] = [q]

      if (chatId) {
        sql = `
          SELECT m.* FROM messages_fts fts
          JOIN messages m ON m.rowid = fts.rowid
          WHERE messages_fts MATCH ? AND m.chat_id = ?
          ORDER BY m.timestamp DESC
          LIMIT ?
        `
        params.push(chatId, limit)
      } else {
        sql = `
          SELECT m.* FROM messages_fts fts
          JOIN messages m ON m.rowid = fts.rowid
          WHERE messages_fts MATCH ?
          ORDER BY m.timestamp DESC
          LIMIT ?
        `
        params.push(limit)
      }

      const messages = db.prepare(sql).all(...params) as MessageRow[]

      res.json({ data: messages, count: messages.length })
    } catch (error) {
      res.status(500).json({ error: 'Full-text search failed' })
    }
  })

  app.get('/api/stats', (_req: Request, res: Response) => {
    try {
      const messages = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as CountRow).count
      const chats = (db.prepare('SELECT COUNT(*) as count FROM chats').get() as CountRow).count
      const contacts = (db.prepare('SELECT COUNT(*) as count FROM contacts').get() as CountRow).count

      const lastSync = db.prepare(
        'SELECT * FROM sync_log WHERE is_latest = 1 ORDER BY created_at DESC LIMIT 1'
      ).get() as SyncLogRow | undefined

      res.json({
        messages,
        chats,
        contacts,
        last_sync: lastSync ?? null,
      })
    } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve stats' })
    }
  })

  app.post('/api/send', async (req: Request, res: Response) => {
    const { jid, text } = req.body as { jid?: string; text?: string }

    if (!jid || !text) {
      res.status(400).json({ error: 'Both "jid" and "text" fields are required' })
      return
    }

    const { sock } = socketHolder
    if (!sock) {
      res.status(503).json({ error: 'WhatsApp is not connected' })
      return
    }

    try {
      const result = await sock.sendMessage(jid, { text })
      res.json({
        success: true,
        messageId: result?.key?.id ?? null,
        jid,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[SEND] Failed to send to ${jid}:`, message)
      res.status(500).json({ error: `Failed to send message: ${message}` })
    }
  })
}
