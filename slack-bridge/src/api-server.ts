import express from 'express'
import type { Request, Response } from 'express'
import type Database from 'better-sqlite3'
import type { SlackApp } from './slack.js'

interface ApiServerOptions {
  readonly db: Database.Database
  readonly port: number
  readonly slackApp: SlackApp
}

export function createApiServer({ db, port, slackApp }: ApiServerOptions) {
  const app = express()
  app.use(express.json())

  app.get('/status', (_req: Request, res: Response) => {
    interface CountRow { count: number }
    const messages = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as CountRow).count
    const channels = (db.prepare('SELECT COUNT(*) as count FROM channels').get() as CountRow).count
    const users = (db.prepare('SELECT COUNT(*) as count FROM users').get() as CountRow).count

    res.json({
      status: 'ok',
      service: 'slack-bridge',
      timestamp: new Date().toISOString(),
      archive: { messages, channels, users },
    })
  })

  app.get('/api/channels', (req: Request, res: Response) => {
    const query = (req.query.query as string) || ''
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)
    const offset = parseInt(req.query.offset as string) || 0
    const type = (req.query.type as string) || ''

    let sql = 'SELECT * FROM channels WHERE 1=1'
    const params: unknown[] = []

    if (query) {
      sql += ' AND name LIKE ?'
      params.push(`%${query}%`)
    }

    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }

    sql += ' ORDER BY last_message_at DESC NULLS LAST LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(sql).all(...params)
    res.json({ data: rows, limit, offset })
  })

  app.get('/api/messages', (req: Request, res: Response) => {
    const channelId = (req.query.channel_id as string) || ''
    const userId = (req.query.user_id as string) || ''
    const query = (req.query.query as string) || ''
    const threadTs = (req.query.thread_ts as string) || ''
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)
    const offset = parseInt(req.query.offset as string) || 0

    let sql = 'SELECT * FROM messages WHERE 1=1'
    const params: unknown[] = []

    if (channelId) {
      sql += ' AND channel_id = ?'
      params.push(channelId)
    }

    if (userId) {
      sql += ' AND user_id = ?'
      params.push(userId)
    }

    if (query) {
      sql += ' AND content LIKE ?'
      params.push(`%${query}%`)
    }

    if (threadTs) {
      sql += ' AND (thread_ts = ? OR id = ?)'
      params.push(threadTs, threadTs)
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(sql).all(...params)
    res.json({ data: rows, limit, offset })
  })

  app.post('/api/send', async (req: Request, res: Response) => {
    const { channel, text, thread_ts } = req.body as {
      channel?: string
      text?: string
      thread_ts?: string
    }

    if (!channel || !text) {
      res.status(400).json({ error: 'channel and text are required' })
      return
    }

    try {
      const result = await slackApp.client.chat.postMessage({
        channel,
        text,
        thread_ts,
      })

      res.json({
        success: true,
        ts: result.ts,
        channel: result.channel,
      })
    } catch (err) {
      console.error('[API] Send error:', err)
      res.status(500).json({ error: 'Failed to send message' })
    }
  })

  app.get('/api/users', (req: Request, res: Response) => {
    const query = (req.query.query as string) || ''
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)

    let sql = 'SELECT * FROM users WHERE 1=1'
    const params: unknown[] = []

    if (query) {
      sql += ' AND (name LIKE ? OR display_name LIKE ? OR real_name LIKE ?)'
      params.push(`%${query}%`, `%${query}%`, `%${query}%`)
    }

    sql += ' ORDER BY last_seen DESC NULLS LAST LIMIT ?'
    params.push(limit)

    const rows = db.prepare(sql).all(...params)
    res.json({ data: rows, limit })
  })

  app.get('/api/search', (req: Request, res: Response) => {
    const q = (req.query.q as string) || ''
    const channelId = (req.query.channel_id as string) || ''
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)

    if (!q) {
      res.status(400).json({ error: 'q parameter is required' })
      return
    }

    let sql = `
      SELECT m.* FROM messages m
      JOIN messages_fts fts ON m.rowid = fts.rowid
      WHERE messages_fts MATCH ?
    `
    const params: unknown[] = [q]

    if (channelId) {
      sql += ' AND m.channel_id = ?'
      params.push(channelId)
    }

    sql += ' ORDER BY m.timestamp DESC LIMIT ?'
    params.push(limit)

    try {
      const rows = db.prepare(sql).all(...params)
      res.json({ data: rows, query: q, limit })
    } catch (err) {
      console.error('[API] Search error:', err)
      res.status(500).json({ error: 'Search failed' })
    }
  })

  app.get('/api/stats', (_req: Request, res: Response) => {
    interface CountRow { count: number }
    interface ChannelRow { channel_id: string; count: number; name: string | null }

    const totalMessages = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as CountRow).count
    const totalChannels = (db.prepare('SELECT COUNT(*) as count FROM channels').get() as CountRow).count
    const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as CountRow).count

    const topChannels = db.prepare(`
      SELECT m.channel_id, COUNT(*) as count, c.name
      FROM messages m
      LEFT JOIN channels c ON m.channel_id = c.id
      GROUP BY m.channel_id
      ORDER BY count DESC
      LIMIT 10
    `).all() as ChannelRow[]

    res.json({
      totalMessages,
      totalChannels,
      totalUsers,
      topChannels,
    })
  })

  function start(): Promise<void> {
    return new Promise((resolve) => {
      app.listen(port, () => {
        console.log(`[API] HTTP server listening on http://localhost:${port}`)
        resolve()
      })
    })
  }

  return { app, start }
}

export type ApiServer = ReturnType<typeof createApiServer>
