import Database from 'better-sqlite3'

const db = new Database('./data/archive.db', { readonly: true })

// Build full name resolution map using ALL strategies

// Strategy 1: Named contacts with LID field in raw_json -> direct @lid chat match
const namedWithLid = db.prepare(`
  SELECT display_name,
         json_extract(raw_json, '$.name') as json_name,
         json_extract(raw_json, '$.lid') as lid
  FROM contacts
  WHERE raw_json IS NOT NULL
    AND json_extract(raw_json, '$.lid') IS NOT NULL
`).all() as any[]

const lidToName = new Map<string, string>()
for (const c of namedWithLid) {
  const name = c.display_name || c.json_name
  if (name && c.lid) {
    lidToName.set(c.lid, name)
  }
}
console.log('Strategy 1 - LID to name mappings:', lidToName.size)

// Strategy 2: Named contacts with @s.whatsapp.net ID that also have a LID
// Build phone -> name map from named contacts (phone extracted from ID)
const namedContactPhones = db.prepare(`
  SELECT id, phone, display_name,
         json_extract(raw_json, '$.name') as json_name
  FROM contacts
  WHERE (display_name IS NOT NULL OR json_extract(raw_json, '$.name') IS NOT NULL)
    AND phone IS NOT NULL
`).all() as any[]

const phoneToName = new Map<string, string>()
for (const c of namedContactPhones) {
  const name = c.display_name || c.json_name
  if (name) {
    // Store with and without + prefix, and also just digits
    const phone = c.phone
    phoneToName.set(phone, name)
    phoneToName.set(phone.replace('+', ''), name)
  }
}
console.log('Strategy 2 - Phone to name mappings:', phoneToName.size)

// Strategy 3: pushName from messages
const msgPushNames = db.prepare(`
  SELECT DISTINCT m.chat_id,
         json_extract(m.raw_json, '$.pushName') as pushName
  FROM messages m
  WHERE json_extract(m.raw_json, '$.pushName') IS NOT NULL
    AND m.direction = 'received'
`).all() as any[]

const chatPushNames = new Map<string, string>()
for (const m of msgPushNames) {
  if (m.pushName && m.chat_id) {
    chatPushNames.set(m.chat_id, m.pushName)
  }
}
console.log('Strategy 3 - Chat pushName mappings:', chatPushNames.size)

// Strategy 4: sender_name from messages
const senderNames = db.prepare(`
  SELECT DISTINCT m.chat_id, m.sender_name
  FROM messages m
  WHERE m.sender_name IS NOT NULL
    AND m.direction = 'received'
    AND m.sender_name != 'Orlando Bruno'
`).all() as any[]

const chatSenderNames = new Map<string, string>()
for (const s of senderNames) {
  if (s.sender_name && s.chat_id) {
    chatSenderNames.set(s.chat_id, s.sender_name)
  }
}
console.log('Strategy 4 - Sender name mappings:', chatSenderNames.size)

// Strategy 5: remoteJidAlt bridge (message key.remoteJidAlt -> lid -> name)
const altMappings = db.prepare(`
  SELECT DISTINCT
    json_extract(raw_json, '$.key.remoteJid') as remoteJid,
    json_extract(raw_json, '$.key.remoteJidAlt') as remoteJidAlt
  FROM messages
  WHERE raw_json IS NOT NULL
    AND json_extract(raw_json, '$.key.remoteJidAlt') IS NOT NULL
    AND json_extract(raw_json, '$.key.remoteJidAlt') != ''
`).all() as any[]

const chatToLidAlt = new Map<string, string>()
for (const m of altMappings) {
  if (m.remoteJid && m.remoteJidAlt) {
    chatToLidAlt.set(m.remoteJid, m.remoteJidAlt)
  }
}
console.log('Strategy 5 - remoteJidAlt mappings:', chatToLidAlt.size)

// Now resolve ALL individual chats
const individualChats = db.prepare(`
  SELECT ch.id, c.phone
  FROM chats ch
  LEFT JOIN contacts c ON ch.id = c.id
  WHERE ch.chat_type = 'individual'
`).all() as any[]

let resolved = 0
let unresolved = 0
const resolvedMap = new Map<string, { name: string; strategy: string }>()
const unresolvedIds: string[] = []

for (const chat of individualChats) {
  let name: string | undefined
  let strategy = ''

  // 1. Direct LID match
  name = lidToName.get(chat.id)
  if (name) { strategy = 'lid-direct'; }

  // 2. remoteJidAlt bridge
  if (name === undefined) {
    const lidAlt = chatToLidAlt.get(chat.id)
    if (lidAlt) {
      name = lidToName.get(lidAlt)
      if (name) strategy = 'remoteJidAlt'
    }
  }

  // 3. Phone match (from contact phone or extracted from chat ID)
  if (name === undefined) {
    const phone = chat.phone ? chat.phone.replace('+', '') : ''
    const idPhone = chat.id.replace('@s.whatsapp.net', '').replace('@lid', '')
    name = phoneToName.get(phone) || phoneToName.get(idPhone)
    if (name) strategy = 'phone-match'
  }

  // 4. pushName from messages
  if (name === undefined) {
    name = chatPushNames.get(chat.id)
    if (name) strategy = 'pushName'
  }

  // 5. sender_name from messages
  if (name === undefined) {
    name = chatSenderNames.get(chat.id)
    if (name) strategy = 'sender_name'
  }

  if (name !== undefined) {
    resolved++
    resolvedMap.set(chat.id, { name, strategy })
  } else {
    unresolved++
    if (unresolvedIds.length < 15) unresolvedIds.push(chat.id)
  }
}

console.log('\n========== FINAL RESOLUTION RESULTS ==========')
console.log('Total individual chats:', individualChats.length)
console.log('Resolved:', resolved, `(${(resolved / individualChats.length * 100).toFixed(1)}%)`)
console.log('Unresolved:', unresolved)

// Count by strategy
const strategyCounts: Record<string, number> = {}
for (const { strategy } of resolvedMap.values()) {
  strategyCounts[strategy] = (strategyCounts[strategy] || 0) + 1
}
console.log('\nBy strategy:', JSON.stringify(strategyCounts, null, 2))

console.log('\nSample resolved:')
let count = 0
for (const [id, { name, strategy }] of resolvedMap) {
  if (count++ >= 15) break
  console.log(`  ${id} -> "${name}" [${strategy}]`)
}

console.log('\nSample unresolved:')
for (const id of unresolvedIds) {
  const contact = db.prepare(`SELECT phone FROM contacts WHERE id = ?`).get(id) as any
  console.log(`  ${id} (phone: ${contact?.phone || 'unknown'})`)
}

// Check: what percentage of MESSAGES (not chats) are resolved?
let resolvedMsgCount = 0
let unresolvedMsgCount = 0
for (const chat of individualChats) {
  const msgCount = db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ?`).get(chat.id) as any
  if (resolvedMap.has(chat.id)) {
    resolvedMsgCount += msgCount.cnt
  } else {
    unresolvedMsgCount += msgCount.cnt
  }
}
console.log('\n=== Message coverage ===')
console.log('Messages in resolved chats:', resolvedMsgCount)
console.log('Messages in unresolved chats:', unresolvedMsgCount)
console.log('Message resolution rate:', (resolvedMsgCount / (resolvedMsgCount + unresolvedMsgCount) * 100).toFixed(1) + '%')

db.close()
