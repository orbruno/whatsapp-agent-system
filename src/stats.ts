import Database from 'better-sqlite3'
import { loadConfig } from './config.js'

const config = loadConfig()
const db = new Database(config.dbPath, { readonly: true })

interface StatRow { count: number }
interface ChatRow { chat_name: string | null; chat_type: string; total_messages: number; id: string }
interface ContactRow { display_name: string | null; push_name: string | null; phone: string | null; message_count: number }
interface DateRow { day: string; count: number }
interface TypeRow { message_type: string; count: number }
interface TimeRangeRow { min_ts: number | null; max_ts: number | null }

function formatDate(ts: number | null): string {
  if (!ts) return 'N/A'
  return new Date(ts * 1000).toISOString().split('T')[0]
}

function run() {
  const messageCount = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as StatRow).count
  const chatCount = (db.prepare('SELECT COUNT(*) as count FROM chats').get() as StatRow).count
  const contactCount = (db.prepare('SELECT COUNT(*) as count FROM contacts').get() as StatRow).count

  const timeRange = db.prepare(
    'SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts FROM messages'
  ).get() as TimeRangeRow

  const sentCount = (db.prepare(
    "SELECT COUNT(*) as count FROM messages WHERE direction = 'sent'"
  ).get() as StatRow).count

  const receivedCount = (db.prepare(
    "SELECT COUNT(*) as count FROM messages WHERE direction = 'received'"
  ).get() as StatRow).count

  console.log('WhatsApp Archive Statistics')
  console.log('===========================')
  console.log(`Total messages:  ${messageCount.toLocaleString()}`)
  console.log(`  Sent:          ${sentCount.toLocaleString()}`)
  console.log(`  Received:      ${receivedCount.toLocaleString()}`)
  console.log(`Total chats:     ${chatCount.toLocaleString()}`)
  console.log(`Total contacts:  ${contactCount.toLocaleString()}`)
  console.log(`Date range:      ${formatDate(timeRange.min_ts)} to ${formatDate(timeRange.max_ts)}`)
  console.log()

  // Top chats by message count
  const topChats = db.prepare(`
    SELECT c.id, c.chat_name, c.chat_type, c.total_messages
    FROM chats c
    WHERE c.total_messages > 0
    ORDER BY c.total_messages DESC
    LIMIT 15
  `).all() as ChatRow[]

  if (topChats.length > 0) {
    console.log('Top 15 Chats')
    console.log('------------')
    for (const chat of topChats) {
      const name = chat.chat_name || chat.id.split('@')[0]
      const type = chat.chat_type === 'group' ? ' [group]' : ''
      console.log(`  ${chat.total_messages.toString().padStart(6)} msgs  ${name}${type}`)
    }
    console.log()
  }

  // Message types
  const types = db.prepare(`
    SELECT message_type, COUNT(*) as count
    FROM messages
    GROUP BY message_type
    ORDER BY count DESC
  `).all() as TypeRow[]

  console.log('Message Types')
  console.log('-------------')
  for (const t of types) {
    console.log(`  ${t.count.toString().padStart(8)}  ${t.message_type}`)
  }
  console.log()

  // Messages per month
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', timestamp, 'unixepoch') as day, COUNT(*) as count
    FROM messages
    GROUP BY day
    ORDER BY day
  `).all() as DateRow[]

  if (monthly.length > 0) {
    console.log('Messages per Month')
    console.log('------------------')
    const maxCount = Math.max(...monthly.map(m => m.count))
    for (const m of monthly) {
      const barLen = Math.round((m.count / maxCount) * 40)
      const bar = '#'.repeat(barLen)
      console.log(`  ${m.day}  ${m.count.toString().padStart(6)}  ${bar}`)
    }
    console.log()
  }

  // Search example
  const args = process.argv.slice(2)
  if (args.length > 0 && args[0] === '--search') {
    const query = args.slice(1).join(' ')
    if (query) {
      const results = db.prepare(`
        SELECT m.content, m.timestamp, m.direction, m.sender_name, c.chat_name
        FROM messages m
        JOIN chats c ON m.chat_id = c.id
        WHERE m.rowid IN (
          SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?
        )
        ORDER BY m.timestamp DESC
        LIMIT 20
      `).all(query) as any[]

      console.log(`Search: "${query}" (${results.length} results)`)
      console.log('------')
      for (const r of results) {
        const date = formatDate(r.timestamp)
        const dir = r.direction === 'sent' ? '>' : '<'
        const chat = r.chat_name || 'DM'
        const sender = r.sender_name || ''
        console.log(`  ${date} ${dir} [${chat}] ${sender}: ${(r.content || '').slice(0, 100)}`)
      }
    }
  }

  db.close()
}

run()
