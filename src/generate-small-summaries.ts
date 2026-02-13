import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, basename } from 'path'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const EXPORT_DIR = resolve(PROJECT_ROOT, 'data/chat-exports')
const SUMMARY_DIR = resolve(PROJECT_ROOT, 'data/summaries')

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

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return mins > 0 ? `${mins}m${secs}s` : `${secs}s`
}

function mediaTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    image: 'image',
    video: 'video',
    audio: 'voice note',
    document: 'document',
    sticker: 'sticker',
  }
  return labels[type] || type
}

function mediaLink(ref: MediaRef): string {
  if (!ref.localPath) return '*not downloaded*'
  const action = ref.type === 'audio' ? 'listen' : 'view'
  return `[${action}](${ref.localPath})`
}

function buildMediaTable(mediaFiles: MediaRef[]): string {
  if (mediaFiles.length === 0) return ''

  const rows = mediaFiles.map((m) => {
    const caption = m.caption
      ? `"${m.caption.slice(0, 60)}${m.caption.length > 60 ? '...' : ''}"`
      : m.durationSeconds
        ? `(${mediaTypeLabel(m.type)}, ${formatDuration(m.durationSeconds)})`
        : m.filename || `(${mediaTypeLabel(m.type)})`
    return `| ${m.date} | ${mediaTypeLabel(m.type)} | ${caption} | ${mediaLink(m)} |`
  })

  return [
    '## Media Attachments',
    '',
    '| Date | Type | Caption | File |',
    '|------|------|---------|------|',
    ...rows,
  ].join('\n')
}

function formatMessage(msg: ExportMessage): string {
  const dir = msg.direction === 'sent' ? '>' : '<'
  const prefix = `**${msg.date}** ${dir} **${msg.sender}**`

  if (msg.type === 'text' && msg.content) {
    return `${prefix}: ${msg.content}`
  }

  if (msg.content) {
    return `${prefix} [${msg.type}]: ${msg.content}`
  }

  return `${prefix} [${msg.type}]`
}

function generateSmallSummary(chat: ChatExport): string {
  const frontmatter = [
    '---',
    `chat_id: "${chat.chatId}"`,
    `chat_name: "${chat.chatName.replace(/"/g, '\\"')}"`,
    `chat_type: ${chat.chatType}`,
    `messages: ${chat.messageCount}`,
    `first_message: "${chat.dateRange.first}"`,
    `last_message: "${chat.dateRange.last}"`,
    `participants: [${chat.participants.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(', ')}]`,
    `media_count: ${chat.mediaFiles.length}`,
    '---',
  ].join('\n')

  const title = `# ${chat.chatName}`

  const summary = chat.messageCount === 0
    ? 'No messages in this chat.'
    : chat.messageCount === 1
      ? `Brief exchange with ${chat.messageCount} message.`
      : `Brief exchange with ${chat.messageCount} messages between ${chat.dateRange.first} and ${chat.dateRange.last}.`

  const transcript = chat.messages.map(formatMessage).join('\n\n')

  const mediaTable = buildMediaTable(chat.mediaFiles)

  const sections = [
    frontmatter,
    '',
    title,
    '',
    '## Summary',
    '',
    summary,
    '',
    '## Messages',
    '',
    transcript,
  ]

  if (mediaTable) {
    sections.push('', mediaTable)
  }

  return sections.join('\n') + '\n'
}

function run() {
  if (!existsSync(EXPORT_DIR)) {
    console.error(`Export directory not found: ${EXPORT_DIR}`)
    console.error('Run export-chats.ts first.')
    process.exit(1)
  }

  if (!existsSync(SUMMARY_DIR)) {
    mkdirSync(SUMMARY_DIR, { recursive: true })
  }

  const files = readdirSync(EXPORT_DIR).filter((f) => f.endsWith('.json'))
  console.log(`Found ${files.length} exported chats`)

  let generated = 0
  let skipped = 0

  for (const file of files) {
    const raw = readFileSync(resolve(EXPORT_DIR, file), 'utf-8')
    const chat: ChatExport = JSON.parse(raw)

    if (chat.messageCount >= 10) {
      skipped++
      continue
    }

    const mdFilename = file.replace('.json', '.md')
    const md = generateSmallSummary(chat)

    writeFileSync(resolve(SUMMARY_DIR, mdFilename), md)
    generated++
  }

  console.log(`Generated ${generated} small summaries (skipped ${skipped} with 10+ messages)`)
  console.log(`Output: ${SUMMARY_DIR}`)
}

run()
