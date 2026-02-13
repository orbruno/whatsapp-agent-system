import Database from 'better-sqlite3'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { resolve, relative } from 'path'
import { loadConfig } from './config.js'
import { execSync } from 'child_process'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const EXPORT_DIR = resolve(PROJECT_ROOT, 'data/chat-exports')
const GOOGLE_CONTACTS_PATH = resolve(PROJECT_ROOT, 'data/google-contacts.csv')
const MACOS_CONTACTS_DB = resolve(
  process.env.HOME || '',
  'Library/Application Support/AddressBook/Sources'
)

interface ChatRow {
  id: string
  chat_type: string
  chat_name: string | null
}

interface ContactRow {
  id: string
  display_name: string | null
  push_name: string | null
  phone: string | null
}

interface MessageRow {
  id: string
  chat_id: string
  contact_id: string | null
  direction: string
  message_type: string
  content: string | null
  timestamp: number
  sender_name: string | null
  reply_to_id: string | null
  is_forwarded: number
  media_mime_type: string | null
  media_size_bytes: number | null
  media_filename: string | null
  media_duration_seconds: number | null
  media_local_path: string | null
}

interface ChatExport {
  chatId: string
  chatName: string
  chatType: string
  messageCount: number
  dateRange: { first: string; last: string }
  participants: string[]
  mediaFiles: MediaRef[]
  messages: ExportMessage[]
}

interface MediaRef {
  messageId: string
  type: string
  mimeType: string | null
  caption: string | null
  localPath: string | null
  filename: string | null
  durationSeconds: number | null
  date: string
}

interface ExportMessage {
  timestamp: number
  date: string
  sender: string
  direction: string
  type: string
  content: string | null
  mediaRef: string | null
  replyTo: string | null
  isForwarded: boolean
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString().split('T')[0]
}

function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function loadGoogleContacts(): Map<string, string> {
  const phoneToName = new Map<string, string>()
  if (!existsSync(GOOGLE_CONTACTS_PATH)) return phoneToName

  console.log('Loading Google Contacts CSV...')
  const csv = readFileSync(GOOGLE_CONTACTS_PATH, 'utf-8')
  const lines = csv.split('\n')
  if (lines.length < 2) return phoneToName

  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim())
  const nameIdx = headers.findIndex(h => h === 'Name' || h === 'Display Name')
  const phoneIdxes: number[] = []
  headers.forEach((h, i) => {
    if (h.toLowerCase().includes('phone') && h.toLowerCase().includes('value')) {
      phoneIdxes.push(i)
    }
  })
  // Also check for simple "Phone" columns
  if (phoneIdxes.length === 0) {
    headers.forEach((h, i) => {
      if (h.toLowerCase().includes('phone')) phoneIdxes.push(i)
    })
  }

  if (nameIdx === -1 || phoneIdxes.length === 0) {
    console.log('  CSV format not recognized. Expected "Name" and "Phone" columns.')
    return phoneToName
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    // Simple CSV parse (handles quoted fields)
    const fields: string[] = []
    let current = ''
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue }
      current += ch
    }
    fields.push(current.trim())

    const name = fields[nameIdx]
    if (!name) continue

    for (const idx of phoneIdxes) {
      const phone = fields[idx]
      if (!phone) continue
      // Normalize: strip spaces, dashes, parens, keep + and digits
      const normalized = phone.replace(/[\s\-()]/g, '')
      if (normalized.length < 7) continue
      // Store with and without + prefix
      phoneToName.set(normalized, name)
      phoneToName.set(normalized.replace(/^\+/, ''), name)
      if (!normalized.startsWith('+')) {
        phoneToName.set('+' + normalized, name)
      }
    }
  }

  console.log(`  Loaded ${phoneToName.size / 2} Google Contacts phone mappings`)
  return phoneToName
}

function loadMacOSContacts(): Map<string, string> {
  const phoneToName = new Map<string, string>()
  if (!existsSync(MACOS_CONTACTS_DB)) return phoneToName

  try {
    // Find the largest source DB (most contacts)
    const sources = execSync(`find "${MACOS_CONTACTS_DB}" -name "AddressBook-v22.abcddb"`, {
      encoding: 'utf-8',
    }).trim().split('\n').filter(Boolean)

    for (const dbPath of sources) {
      try {
        const rows = execSync(
          `sqlite3 -csv "${dbPath}" "SELECT COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, ''), p.ZFULLNUMBER FROM ZABCDRECORD r JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK WHERE p.ZFULLNUMBER IS NOT NULL"`,
          { encoding: 'utf-8' }
        ).trim().split('\n').filter(Boolean)

        for (const row of rows) {
          // Parse CSV row (handle quoted fields)
          const match = row.match(/^"?([^"]*)"?,(.+)$/)
          if (!match) continue
          const name = match[1].trim()
          const phone = match[2].trim()
          if (!name || name === ' ') continue

          // Normalize phone: strip everything except digits
          const digits = phone.replace(/[^\d]/g, '')
          if (digits.length < 7) continue
          phoneToName.set(digits, name)
          // Also store without country code for Costa Rica
          if (digits.startsWith('506') && digits.length === 11) {
            phoneToName.set(digits.slice(3), name)
          }
        }
      } catch {
        // Skip inaccessible source DBs
      }
    }
  } catch {
    console.log('  Could not access macOS Contacts database')
  }

  if (phoneToName.size > 0) {
    console.log(`  Loaded ${phoneToName.size} macOS Contacts phone mappings`)
  }
  return phoneToName
}

function buildContactLookup(db: Database.Database): Map<string, string> {
  const lookup = new Map<string, string>()

  // Strategy 1: Direct contact names (display_name or push_name)
  const contacts = db.prepare(
    'SELECT id, display_name, push_name, phone FROM contacts'
  ).all() as ContactRow[]

  for (const c of contacts) {
    const name = c.display_name || c.push_name
    if (name) {
      lookup.set(c.id, name)
    }
  }
  console.log(`  Strategy 1 (direct names): ${lookup.size} contacts`)

  // Strategy 2: LID cross-reference
  // Named contacts have raw_json.lid that maps to @lid chat IDs
  const namedWithLid = db.prepare(`
    SELECT display_name,
           json_extract(raw_json, '$.name') as json_name,
           json_extract(raw_json, '$.lid') as lid
    FROM contacts
    WHERE raw_json IS NOT NULL
      AND json_extract(raw_json, '$.lid') IS NOT NULL
      AND (display_name IS NOT NULL OR json_extract(raw_json, '$.name') IS NOT NULL)
  `).all() as any[]

  let lidResolved = 0
  for (const c of namedWithLid) {
    const name = c.display_name || c.json_name
    if (name && c.lid && !lookup.has(c.lid)) {
      lookup.set(c.lid, name)
      lidResolved++
    }
  }
  console.log(`  Strategy 2 (LID cross-ref): +${lidResolved} contacts`)

  // Strategy 3: pushName from live-received messages
  const msgPushNames = db.prepare(`
    SELECT DISTINCT m.chat_id,
           json_extract(m.raw_json, '$.pushName') as pushName
    FROM messages m
    WHERE json_extract(m.raw_json, '$.pushName') IS NOT NULL
      AND m.direction = 'received'
  `).all() as any[]

  let pushResolved = 0
  for (const m of msgPushNames) {
    if (m.pushName && m.chat_id && !lookup.has(m.chat_id)) {
      lookup.set(m.chat_id, m.pushName)
      pushResolved++
    }
  }
  console.log(`  Strategy 3 (message pushName): +${pushResolved} contacts`)

  // Strategy 4: Google Contacts CSV import
  const googleContacts = loadGoogleContacts()
  if (googleContacts.size > 0) {
    const chats = db.prepare(
      "SELECT id FROM chats WHERE chat_type = 'individual'"
    ).all() as any[]

    let googleResolved = 0
    for (const chat of chats) {
      if (lookup.has(chat.id)) continue
      // Extract phone from chat ID
      const phone = chat.id.split('@')[0]
      const name = googleContacts.get(phone) || googleContacts.get('+' + phone)
      if (name) {
        lookup.set(chat.id, name)
        googleResolved++
      }
    }
    console.log(`  Strategy 4 (Google Contacts): +${googleResolved} contacts`)
  }

  // Strategy 5: macOS Contacts (iCloud-synced address book)
  const macContacts = loadMacOSContacts()
  if (macContacts.size > 0) {
    const individualChats = db.prepare(
      "SELECT id FROM chats WHERE chat_type = 'individual'"
    ).all() as { id: string }[]

    let macResolved = 0
    for (const chat of individualChats) {
      if (lookup.has(chat.id)) continue
      const phone = chat.id.split('@')[0]
      const name = macContacts.get(phone)
      if (name) {
        lookup.set(chat.id, name)
        macResolved++
      }
    }
    console.log(`  Strategy 5 (macOS Contacts): +${macResolved} contacts`)
  }

  return lookup
}

function resolveChatName(
  chat: ChatRow,
  contactLookup: Map<string, string>
): string {
  if (chat.chat_name) return chat.chat_name

  const contactName = contactLookup.get(chat.id)
  if (contactName) return contactName

  if (chat.chat_type === 'individual') {
    const phone = chat.id.split('@')[0]
    return `+${phone}`
  }

  const shortId = chat.id.split('@')[0].slice(-12)
  return `group-${shortId}`
}

function resolveSenderName(
  msg: MessageRow,
  contactLookup: Map<string, string>
): string {
  if (msg.direction === 'sent') return 'Orlando'

  if (msg.sender_name) return msg.sender_name

  if (msg.contact_id) {
    const name = contactLookup.get(msg.contact_id)
    if (name) return name
    const phone = msg.contact_id.split('@')[0]
    return `+${phone}`
  }

  return 'Unknown'
}

function makeRelativeMediaPath(absolutePath: string): string {
  return relative(resolve(PROJECT_ROOT, 'data/summaries'), absolutePath)
}

function deduplicateFilename(
  desired: string,
  usedNames: Set<string>
): string {
  if (!usedNames.has(desired)) {
    usedNames.add(desired)
    return desired
  }
  let counter = 2
  while (usedNames.has(`${desired.replace('.json', '')}-${counter}.json`)) {
    counter++
  }
  const deduped = `${desired.replace('.json', '')}-${counter}.json`
  usedNames.add(deduped)
  return deduped
}

function run() {
  const config = loadConfig()
  const db = new Database(config.dbPath, { readonly: true })

  if (!existsSync(EXPORT_DIR)) {
    mkdirSync(EXPORT_DIR, { recursive: true })
  }

  const contactLookup = buildContactLookup(db)
  console.log(`Loaded ${contactLookup.size} named contacts`)

  const chats = db.prepare(
    'SELECT id, chat_type, chat_name FROM chats ORDER BY id'
  ).all() as ChatRow[]

  console.log(`Found ${chats.length} chats`)

  const getMessages = db.prepare(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC'
  )

  const usedFilenames = new Set<string>()
  let exported = 0
  let skipped = 0

  for (const chat of chats) {
    const messages = getMessages.all(chat.id) as MessageRow[]

    if (messages.length === 0) {
      skipped++
      continue
    }

    const chatName = resolveChatName(chat, contactLookup)
    const safeName = sanitizeFilename(chatName)
    const filename = deduplicateFilename(`${safeName}.json`, usedFilenames)

    const participants = new Set<string>()
    const mediaFiles: MediaRef[] = []
    const exportMessages: ExportMessage[] = []

    for (const msg of messages) {
      const sender = resolveSenderName(msg, contactLookup)
      participants.add(sender)

      const isMedia = msg.media_mime_type !== null
      let mediaRef: string | null = null

      if (isMedia) {
        const ref: MediaRef = {
          messageId: msg.id,
          type: msg.message_type,
          mimeType: msg.media_mime_type,
          caption: msg.content,
          localPath: msg.media_local_path
            ? makeRelativeMediaPath(msg.media_local_path)
            : null,
          filename: msg.media_filename,
          durationSeconds: msg.media_duration_seconds,
          date: formatDate(msg.timestamp),
        }
        mediaFiles.push(ref)
        mediaRef = msg.id
      }

      exportMessages.push({
        timestamp: msg.timestamp,
        date: formatDateTime(msg.timestamp),
        sender,
        direction: msg.direction,
        type: msg.message_type,
        content: msg.content,
        mediaRef: isMedia ? mediaRef : null,
        replyTo: msg.reply_to_id,
        isForwarded: msg.is_forwarded === 1,
      })
    }

    const firstTs = messages[0].timestamp
    const lastTs = messages[messages.length - 1].timestamp

    const chatExport: ChatExport = {
      chatId: chat.id,
      chatName,
      chatType: chat.chat_type,
      messageCount: messages.length,
      dateRange: {
        first: formatDate(firstTs),
        last: formatDate(lastTs),
      },
      participants: [...participants],
      mediaFiles,
      messages: exportMessages,
    }

    writeFileSync(
      resolve(EXPORT_DIR, filename),
      JSON.stringify(chatExport, null, 2)
    )

    exported++
    if (exported % 100 === 0) {
      console.log(`  Exported ${exported} chats...`)
    }
  }

  console.log(`\nDone! Exported ${exported} chats, skipped ${skipped} empty chats`)
  console.log(`Output: ${EXPORT_DIR}`)

  db.close()
}

run()
