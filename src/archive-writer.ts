import type Database from 'better-sqlite3'
import type { proto } from '@whiskeysockets/baileys'
import type { Statements } from './db.js'
import { parseMessage } from './message-parser.js'

export interface ChatMetadata {
  readonly description?: string | null
  readonly subject?: string | null
  readonly subjectOwner?: string | null
  readonly subjectTime?: string | null
  readonly descriptionOwner?: string | null
  readonly descriptionTime?: string | null
  readonly creationTime?: string | null
  readonly createdBy?: string | null
  readonly restrict?: boolean
  readonly announce?: boolean
  readonly profilePictureUrl?: string | null
}

export interface ContactMetadata {
  readonly about?: string | null
  readonly profilePictureUrl?: string | null
  readonly isBusiness?: boolean
  readonly businessName?: string | null
  readonly verifiedName?: string | null
}

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
          parsed.mentions ? JSON.stringify(parsed.mentions) : null,
          parsed.quotedMessageId,
          parsed.quotedContent,
          parsed.forwardScore,
          parsed.urlPreview ? 1 : 0,
          parsed.urlPreview?.title ?? null,
          parsed.urlPreview?.description ?? null,
          parsed.urlPreview?.url ?? null,
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
        parsed.mentions ? JSON.stringify(parsed.mentions) : null,
        parsed.quotedMessageId,
        parsed.quotedContent,
        parsed.forwardScore,
        parsed.urlPreview ? 1 : 0,
        parsed.urlPreview?.title ?? null,
        parsed.urlPreview?.description ?? null,
        parsed.urlPreview?.url ?? null,
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

  function upsertChatMetadata(chatId: string, metadata: ChatMetadata): void {
    try {
      stmts.upsertChatMetadata.run(
        metadata.description ?? null,
        metadata.subject ?? null,
        metadata.subjectOwner ?? null,
        metadata.subjectTime ?? null,
        metadata.descriptionOwner ?? null,
        metadata.descriptionTime ?? null,
        metadata.creationTime ?? null,
        metadata.createdBy ?? null,
        metadata.restrict ? 1 : 0,
        metadata.announce ? 1 : 0,
        metadata.profilePictureUrl ?? null,
        chatId,
      )
    } catch (err) {
      console.error(`[ARCHIVE] Error upserting chat metadata for ${chatId}:`, err)
    }
  }

  function upsertContactMetadata(contactId: string, metadata: ContactMetadata): void {
    const params = [
      metadata.about ?? null,
      metadata.profilePictureUrl ?? null,
      metadata.isBusiness ? 1 : 0,
      metadata.businessName ?? null,
      metadata.verifiedName ?? null,
      contactId,
    ]
    try {
      stmts.upsertContactMetadata.run(...params)
    } catch (err) {
      console.error(`[ARCHIVE] Error upserting contact metadata for ${contactId}:`, err, 'params:', JSON.stringify(params))
    }
  }

  function upsertParticipant(chatId: string, contactId: string, role: string, addedBy?: string): void {
    try {
      stmts.upsertParticipant.run(chatId, contactId, role, null, addedBy ?? null)
    } catch (err) {
      console.error(`[ARCHIVE] Error upserting participant ${contactId} in ${chatId}:`, err)
    }
  }

  function deactivateParticipant(chatId: string, contactId: string): void {
    try {
      stmts.deactivateParticipant.run(chatId, contactId)
    } catch (err) {
      console.error(`[ARCHIVE] Error deactivating participant ${contactId} in ${chatId}:`, err)
    }
  }

  function updateParticipantRole(chatId: string, contactId: string, role: string): void {
    try {
      stmts.updateParticipantRole.run(role, chatId, contactId)
    } catch (err) {
      console.error(`[ARCHIVE] Error updating role for ${contactId} in ${chatId}:`, err)
    }
  }

  function upsertReaction(messageId: string, contactId: string, reaction: string, timestamp?: string): void {
    try {
      stmts.upsertReaction.run(messageId, contactId, reaction, timestamp ?? null)
    } catch (err) {
      console.error(`[ARCHIVE] Error upserting reaction on ${messageId}:`, err)
    }
  }

  function updateMessageEdited(messageId: string, editedAt: string, newContent?: string): void {
    try {
      stmts.updateMessageEdited.run(editedAt, newContent ?? null, messageId)
    } catch (err) {
      console.error(`[ARCHIVE] Error updating edited message ${messageId}:`, err)
    }
  }

  function updateMessageDeleted(messageId: string): void {
    try {
      stmts.updateMessageDeleted.run(messageId)
    } catch (err) {
      console.error(`[ARCHIVE] Error marking message ${messageId} as deleted:`, err)
    }
  }

  function updateChatFlags(chatId: string, flags: { archived?: boolean; pinned?: boolean; muted?: boolean }): void {
    try {
      stmts.updateChatFlags.run(
        flags.archived ? 1 : 0,
        flags.pinned ? 1 : 0,
        flags.muted ? 1 : 0,
        chatId,
      )
    } catch (err) {
      console.error(`[ARCHIVE] Error updating chat flags for ${chatId}:`, err)
    }
  }

  return {
    writeSyncBatch,
    writeLiveMessage,
    updateChatStats,
    upsertChatMetadata,
    upsertContactMetadata,
    upsertParticipant,
    deactivateParticipant,
    updateParticipantRole,
    upsertReaction,
    updateMessageEdited,
    updateMessageDeleted,
    updateChatFlags,
  }
}

export type ArchiveWriter = ReturnType<typeof createArchiveWriter>
