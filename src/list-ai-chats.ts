import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'

const EXPORT_DIR = resolve(import.meta.dirname, '..', 'data/chat-exports')
const files = readdirSync(EXPORT_DIR).filter(f => f.endsWith('.json')).sort()

interface ChatExport {
  chatId: string
  chatName: string
  chatType: string
  messageCount: number
}

const aiChats: { file: string; name: string; count: number }[] = []

for (const file of files) {
  const data = JSON.parse(readFileSync(resolve(EXPORT_DIR, file), 'utf-8')) as ChatExport
  if (data.messageCount >= 10) {
    aiChats.push({ file, name: data.chatName, count: data.messageCount })
  }
}

// Sort by message count (smallest first for batching)
aiChats.sort((a, b) => a.count - b.count)

console.log(`Total chats needing AI summaries: ${aiChats.length}`)
console.log('\nBy size:')
const small = aiChats.filter(c => c.count < 50)
const medium = aiChats.filter(c => c.count >= 50 && c.count < 200)
const large = aiChats.filter(c => c.count >= 200 && c.count < 500)
const xlarge = aiChats.filter(c => c.count >= 500)

console.log(`  10-49 msgs: ${small.length} chats`)
console.log(`  50-199 msgs: ${medium.length} chats`)
console.log(`  200-499 msgs: ${xlarge.length} chats`)
console.log(`  500+ msgs: ${xlarge.length} chats`)

// Output JSON for programmatic use
console.log('\n--- JSON ---')
console.log(JSON.stringify(aiChats))
