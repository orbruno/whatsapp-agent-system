import type Database from 'better-sqlite3'
import type { proto } from '@whiskeysockets/baileys'
import type { Statements } from './db.js'
import { parseMessage } from './message-parser.js'

export interface SyncBatch {
  readonly messages: proto.IWebMessageInfo[]
  readonly chats: any[]
  readonly contacts: any[]
  readonly isLatest: boolean
  readonly progress: number | undefined
  readonly syncType: number | undefined
}

export interface SyncResult {
  readonly messagesWritten: number
  readonly chatsWritten: number
  readonly contactsWritten: number
}

function jidToPhone(jid: string): string | null {
  const match = jid.match(/^(\d+)@/)
  return match ? `+${match[1]}` : null
}

export function createArchiveWriter(db: Database.Database, stmts: Statements) {
  function writeMessages(
    messages: proto.IWebMessageInfo[],
    source: string,
    origin: string
  ): number {
    let count = 0
    for (const msg of messages) {
      const parsed = parseMessage(msg)
      if (!parsed) continue

      try {
        stmts.insertMessage.run(
          parsed.id,
          parsed.chatId,
          parsed.contactId,
          source,
          origin,
          parsed.direction,
          parsed.messageType,
          parsed.content,
          parsed.timestamp,
          parsed.senderName,
          parsed.replyToId,
          parsed.isForwarded ? 1 : 0,
          parsed.mediaMimeType,
          parsed.mediaSizeBytes,
          parsed.mediaFilename,
          parsed.mediaDurationSeconds,
          JSON.stringify(msg),
        )
        count++
      } catch (err) {
        // INSERT OR IGNORE handles duplicates silently
        // Log other errors
        if (!(err instanceof Error && err.message.includes('UNIQUE'))) {
          console.error(`  Error saving message ${parsed.id}:`, err)
        }
      }
    }
    return count
  }

  function writeChats(chats: any[], source: string): number {
    let count = 0
    for (const chat of chats) {
      const chatId = chat.id
      if (!chatId) continue

      try {
        stmts.insertChat.run(
          chatId,
          chatId.endsWith('@g.us') ? 'group' : 'individual',
          chat.name || chat.subject || null,
          source,
          chat.participantCount || 2,
          0,
          chat.conversationTimestamp ? Number(chat.conversationTimestamp) : null,
          chat.conversationTimestamp ? Number(chat.conversationTimestamp) : null,
          JSON.stringify(chat),
        )
        count++
      } catch (err) {
        console.error(`  Error saving chat ${chatId}:`, err)
      }
    }
    return count
  }

  function writeContacts(contacts: any[], source: string): number {
    let count = 0
    for (const contact of contacts) {
      const contactId = contact.id
      if (!contactId) continue

      try {
        stmts.insertContact.run(
          contactId,
          jidToPhone(contactId),
          contact.name || null,
          contact.notify || null,
          source,
          null,
          null,
          0,
          JSON.stringify(contact),
        )
        count++
      } catch (err) {
        console.error(`  Error saving contact ${contactId}:`, err)
      }
    }
    return count
  }

  function writeSyncBatch(batch: SyncBatch, source: string): SyncResult {
    const result = db.transaction(() => {
      const chatsWritten = writeChats(batch.chats, source)
      const contactsWritten = writeContacts(batch.contacts, source)
      const messagesWritten = writeMessages(batch.messages, source, 'history_sync')

      stmts.logSync.run(
        batch.syncType?.toString() || 'unknown',
        messagesWritten,
        chatsWritten,
        contactsWritten,
        batch.progress || null,
        batch.isLatest ? 1 : 0,
      )

      return { messagesWritten, chatsWritten, contactsWritten }
    })()

    return result
  }

  function writeLiveMessage(msg: proto.IWebMessageInfo, source: string): boolean {
    const parsed = parseMessage(msg)
    if (!parsed) return false

    try {
      stmts.insertMessage.run(
        parsed.id,
        parsed.chatId,
        parsed.contactId,
        source,
        'live_capture',
        parsed.direction,
        parsed.messageType,
        parsed.content,
        parsed.timestamp,
        parsed.senderName,
        parsed.replyToId,
        parsed.isForwarded ? 1 : 0,
        parsed.mediaMimeType,
        parsed.mediaSizeBytes,
        parsed.mediaFilename,
        parsed.mediaDurationSeconds,
        JSON.stringify(msg),
      )
      return true
    } catch {
      return false
    }
  }

  function updateChatStats(): void {
    const chatIds = db.prepare('SELECT DISTINCT id FROM chats').all() as { id: string }[]
    for (const { id } of chatIds) {
      stmts.updateChatMessageCount.run(id, id, id, id)
    }
  }

  return {
    writeSyncBatch,
    writeLiveMessage,
    updateChatStats,
  }
}

export type ArchiveWriter = ReturnType<typeof createArchiveWriter>
