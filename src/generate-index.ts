import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const SUMMARY_DIR = resolve(PROJECT_ROOT, 'data/summaries')

interface ChatMeta {
  filename: string
  chatName: string
  chatType: string
  messages: number
  firstMessage: string
  lastMessage: string
  mediaCount: number
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let value = line.slice(colonIdx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

function run() {
  const files = readdirSync(SUMMARY_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()

  const metas: ChatMeta[] = []

  for (const file of files) {
    const content = readFileSync(resolve(SUMMARY_DIR, file), 'utf-8')
    const fm = parseFrontmatter(content)

    metas.push({
      filename: file,
      chatName: fm['chat_name'] || file.replace('.md', ''),
      chatType: fm['chat_type'] || 'unknown',
      messages: parseInt(fm['messages'] || fm['messages_count'] || fm['message_count'] || '0', 10),
      firstMessage: fm['first_message'] || fm['first_message_date'] || '',
      lastMessage: fm['last_message'] || fm['last_message_date'] || '',
      mediaCount: parseInt(fm['media_count'] || '0', 10),
    })
  }

  metas.sort((a, b) => b.messages - a.messages)

  const totalMessages = metas.reduce((s, m) => s + m.messages, 0)
  const totalMedia = metas.reduce((s, m) => s + m.mediaCount, 0)
  const groups = metas.filter((m) => m.chatType === 'group').length
  const individuals = metas.filter((m) => m.chatType === 'individual').length

  const rows = metas.map((m) => {
    const link = encodeURIComponent(m.filename)
    const type = m.chatType === 'group' ? 'Group' : 'DM'
    const name = m.chatName.replace(/\|/g, '\\|')
    return `| [${name}](${link}) | ${type} | ${m.messages} | ${m.mediaCount} | ${m.firstMessage} | ${m.lastMessage} |`
  })

  const readme = [
    '# WhatsApp Chat Summaries',
    '',
    '## Overview',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total chats | ${metas.length} |`,
    `| Group chats | ${groups} |`,
    `| Individual chats | ${individuals} |`,
    `| Total messages | ${totalMessages.toLocaleString()} |`,
    `| Total media files | ${totalMedia.toLocaleString()} |`,
    '',
    '## All Chats',
    '',
    'Sorted by message count (descending).',
    '',
    '| Chat | Type | Messages | Media | First | Last |',
    '|------|------|----------|-------|-------|------|',
    ...rows,
    '',
  ].join('\n')

  writeFileSync(resolve(SUMMARY_DIR, 'README.md'), readme)
  console.log(`README.md generated with ${metas.length} entries`)
  console.log(`Total messages: ${totalMessages.toLocaleString()}`)
  console.log(`Total media: ${totalMedia.toLocaleString()}`)
}

run()
