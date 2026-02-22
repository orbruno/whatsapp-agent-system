import type { Express, Request, Response } from 'express'
import type Database from 'better-sqlite3'
import type { SocketHolder } from './whatsapp.js'
import type { ArchiveWriter, ChatMetadata, ContactMetadata } from './archive-writer.js'

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

export function createApiRoutes(app: Express, db: Database.Database, socketHolder: SocketHolder, archiveWriter: ArchiveWriter): void {
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
        conditions.push('m.chat_id = ?')
        params.push(chatId)
      }
      if (query) {
        conditions.push('m.content LIKE ?')
        params.push(`%${query}%`)
      }
      if (direction && (direction === 'incoming' || direction === 'outgoing')) {
        conditions.push('m.direction = ?')
        params.push(direction)
      }
      if (before) {
        const ts = parseInt(before, 10)
        if (!Number.isNaN(ts)) {
          conditions.push('m.timestamp < ?')
          params.push(ts)
        }
      }
      if (after) {
        const ts = parseInt(after, 10)
        if (!Number.isNaN(ts)) {
          conditions.push('m.timestamp > ?')
          params.push(ts)
        }
      }

      const mWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const countSql = `SELECT COUNT(*) as count FROM messages m ${mWhere}`
      const total = (db.prepare(countSql).get(...params) as CountRow).count

      params.push(limit, offset)
      const dataSql = `SELECT m.*, c.chat_name, c.chat_type FROM messages m LEFT JOIN chats c ON m.chat_id = c.id ${mWhere} ORDER BY m.timestamp DESC LIMIT ? OFFSET ?`
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
          SELECT m.*, c.chat_name, c.chat_type FROM messages_fts fts
          JOIN messages m ON m.rowid = fts.rowid
          LEFT JOIN chats c ON m.chat_id = c.id
          WHERE messages_fts MATCH ? AND m.chat_id = ?
          ORDER BY m.timestamp DESC
          LIMIT ?
        `
        params.push(chatId, limit)
      } else {
        sql = `
          SELECT m.*, c.chat_name, c.chat_type FROM messages_fts fts
          JOIN messages m ON m.rowid = fts.rowid
          LEFT JOIN chats c ON m.chat_id = c.id
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

  app.post('/api/labels/chat', async (req: Request, res: Response) => {
    const { jid, labelId, action } = req.body as {
      jid?: string
      labelId?: string
      action?: 'add' | 'remove'
    }

    if (!jid || !labelId) {
      res.status(400).json({ error: 'Both "jid" and "labelId" fields are required' })
      return
    }

    const { sock } = socketHolder
    if (!sock) {
      res.status(503).json({ error: 'WhatsApp is not connected' })
      return
    }

    try {
      if (action === 'remove') {
        await sock.removeChatLabel(jid, labelId)
      } else {
        await sock.addChatLabel(jid, labelId)
      }
      res.json({ success: true, jid, labelId, action: action ?? 'add' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[LABELS] Failed to ${action ?? 'add'} label on ${jid}:`, message)
      res.status(500).json({ error: `Failed to ${action ?? 'add'} label: ${message}` })
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

  app.get('/api/chats/:id', (req: Request, res: Response) => {
    const chatId = req.params.id as string
    try {
      const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId)
      if (!chat) {
        res.status(404).json({ error: 'Chat not found' })
        return
      }

      const participantCount = (db.prepare(
        'SELECT COUNT(*) as count FROM chat_participants WHERE chat_id = ? AND is_active = 1'
      ).get(chatId) as CountRow).count

      res.json({ data: { ...chat as ChatRow, active_participants: participantCount } })
    } catch (error) {
      res.status(500).json({ error: 'Failed to get chat' })
    }
  })

  app.get('/api/chats/:id/participants', (req: Request, res: Response) => {
    const chatId = req.params.id as string
    try {
      const participants = db.prepare(`
        SELECT cp.*, co.display_name, co.push_name, co.phone
        FROM chat_participants cp
        LEFT JOIN contacts co ON cp.contact_id = co.id
        WHERE cp.chat_id = ? AND cp.is_active = 1
        ORDER BY CASE cp.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
      `).all(chatId)

      res.json({ data: participants })
    } catch (error) {
      res.status(500).json({ error: 'Failed to get participants' })
    }
  })

  app.get('/api/chats/:id/metadata', async (req: Request, res: Response) => {
    const chatId = req.params.id as string
    const { sock } = socketHolder
    if (!sock) {
      res.status(503).json({ error: 'WhatsApp is not connected' })
      return
    }

    try {
      const meta = await sock.groupMetadata(chatId)
      const chatMeta: ChatMetadata = {
        subject: meta.subject ?? null,
        subjectOwner: meta.subjectOwner ?? null,
        subjectTime: meta.subjectTime ? new Date(meta.subjectTime * 1000).toISOString() : null,
        description: meta.desc ?? null,
        descriptionOwner: meta.descOwner ?? null,
        creationTime: meta.creation ? new Date(meta.creation * 1000).toISOString() : null,
        createdBy: meta.owner ?? null,
        restrict: meta.restrict === true,
        announce: meta.announce === true,
      }
      archiveWriter.upsertChatMetadata(chatId, chatMeta)

      if (meta.participants) {
        for (const p of meta.participants) {
          const role = p.admin === 'superadmin' ? 'superadmin' : p.admin === 'admin' ? 'admin' : 'member'
          archiveWriter.upsertParticipant(chatId, p.id, role)
        }
      }

      res.json({ data: meta })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: `Failed to fetch group metadata: ${message}` })
    }
  })

  app.get('/api/contacts/:id', (req: Request, res: Response) => {
    const contactId = req.params.id as string
    try {
      const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId)
      if (!contact) {
        res.status(404).json({ error: 'Contact not found' })
        return
      }
      res.json({ data: contact })
    } catch (error) {
      res.status(500).json({ error: 'Failed to get contact' })
    }
  })

  app.get('/api/contacts/:id/metadata', async (req: Request, res: Response) => {
    const contactId = req.params.id as string
    const { sock } = socketHolder
    if (!sock) {
      res.status(503).json({ error: 'WhatsApp is not connected' })
      return
    }

    try {
      const statusResult = await sock.fetchStatus(contactId)
      const firstStatus = Array.isArray(statusResult) ? statusResult[0] : statusResult
      let statusText: string | null = null
      if (firstStatus) {
        const raw = (firstStatus as unknown as Record<string, unknown>).status
        if (typeof raw === 'string') {
          statusText = raw || null
        } else if (raw && typeof raw === 'object') {
          const inner = (raw as Record<string, unknown>).status
          statusText = typeof inner === 'string' ? (inner || null) : null
        }
      }
      let profilePicUrl: string | null = null
      try {
        profilePicUrl = await sock.profilePictureUrl(contactId, 'image') ?? null
      } catch {
        // No profile picture available
      }

      const metadata: ContactMetadata = {
        about: statusText,
        profilePictureUrl: profilePicUrl,
        isBusiness: false,
        businessName: null,
        verifiedName: null,
      }
      archiveWriter.upsertContactMetadata(contactId, metadata)

      res.json({ data: { ...metadata, id: contactId } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: `Failed to fetch contact metadata: ${message}` })
    }
  })

  app.get('/api/messages/:id/reactions', (req: Request, res: Response) => {
    const messageId = req.params.id as string
    try {
      const reactions = db.prepare(`
        SELECT mr.*, co.display_name, co.push_name
        FROM message_reactions mr
        LEFT JOIN contacts co ON mr.contact_id = co.id
        WHERE mr.message_id = ?
      `).all(messageId)

      res.json({ data: reactions })
    } catch (error) {
      res.status(500).json({ error: 'Failed to get reactions' })
    }
  })
}
