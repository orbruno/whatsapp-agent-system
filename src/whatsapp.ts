import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WAMessageStubType,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import type { ArchiveWriter, ChatMetadata, ContactMetadata } from './archive-writer.js'
import type { createQrServer } from './qr-server.js'
import type { MediaDownloader } from './media-downloader.js'
import type Database from 'better-sqlite3'

interface WhatsAppOptions {
  readonly authPath: string
  readonly source: string
  readonly archiveWriter: ArchiveWriter
  readonly qrServer: ReturnType<typeof createQrServer>
  readonly mediaDownloader: MediaDownloader
  readonly updateMediaPath: Database.Statement
  readonly onSyncComplete?: () => void
  readonly db: Database.Database
}

export type WASocket = ReturnType<typeof makeWASocket>

export interface SocketHolder {
  sock: WASocket | null
}

export async function connectWhatsApp(options: WhatsAppOptions, socketHolder?: SocketHolder): Promise<WASocket> {
  const { authPath, source, archiveWriter, qrServer, mediaDownloader, updateMediaPath, onSyncComplete, db } = options
  const { state, saveCreds } = await useMultiFileAuthState(authPath)

  const sock = makeWASocket({
    auth: state,
    browser: ['macOS', 'Bot', 'Chrome'],
    syncFullHistory: true,
    markOnlineOnConnect: false,
    printQRInTerminal: false,
    logger: pino({ level: 'warn' }),
    generateHighQualityLinkPreview: false,
    fireInitQueries: true,
    connectTimeoutMs: 180_000,
    defaultQueryTimeoutMs: 120_000,
    keepAliveIntervalMs: 30_000,
    shouldSyncHistoryMessage: () => true,
  })

  if (socketHolder) {
    socketHolder.sock = sock
  }

  let totalSyncedMessages = 0
  let totalSyncedChats = 0
  let totalSyncedContacts = 0
  let syncBatchCount = 0

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr, isNewLogin } = update

    if (qr) {
      await qrServer.updateQr(qr)
    }

    if (isNewLogin) {
      console.log('[WA] New login detected - full history sync will start')
    }

    if (connection === 'close') {
      qrServer.setConnected(false)
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('[WA] Logged out. Delete data/auth_info/ and restart to re-scan QR.')
      } else {
        console.log(`[WA] Disconnected (code ${statusCode}). Reconnecting in 5s...`)
        if (shouldReconnect) {
          setTimeout(() => connectWhatsApp(options, socketHolder), 5000)
        }
      }
    }

    if (connection === 'open') {
      qrServer.setConnected(true)
      console.log('[WA] Connected! Waiting for history sync...')
      console.log('[WA] Keep your phone on WiFi, plugged in, and WhatsApp open.')
      console.log('[WA] (This can take 5-15 minutes for large chat histories)')

      // Fire-and-forget metadata enrichment
      enrichMetadata(sock, db, archiveWriter).catch((err) => {
        console.error('[ENRICH] Metadata enrichment failed:', err)
      })
    }
  })

  // Primary: history sync batches (arrives during initial link)
  sock.ev.on('messaging-history.set', (data) => {
    const { chats, contacts, messages, isLatest, progress, syncType } = data
    syncBatchCount++

    console.log(`\n[SYNC] Batch #${syncBatchCount} | Progress: ${progress ?? '?'}% | Type: ${syncType ?? '?'}`)
    console.log(`  Received: ${messages.length} msgs, ${chats.length} chats, ${contacts.length} contacts`)

    if (messages.length > 0 || chats.length > 0 || contacts.length > 0) {
      const result = archiveWriter.writeSyncBatch(
        {
          messages,
          chats,
          contacts,
          isLatest: isLatest ?? false,
          progress: progress ?? 0,
          syncType: syncType ?? undefined,
        },
        source,
      )

      totalSyncedMessages += result.messagesWritten
      totalSyncedChats += result.chatsWritten
      totalSyncedContacts += result.contactsWritten

      console.log(`  Written: ${result.messagesWritten} msgs, ${result.chatsWritten} chats, ${result.contactsWritten} contacts`)
      console.log(`  Total so far: ${totalSyncedMessages} msgs, ${totalSyncedChats} chats, ${totalSyncedContacts} contacts`)
    } else {
      console.log('  (empty batch)')
    }

    qrServer.updateStats({
      syncProgress: progress ?? 0,
      totalMessages: totalSyncedMessages,
      totalChats: totalSyncedChats,
      totalContacts: totalSyncedContacts,
    })

    if (isLatest) {
      console.log('\n[SYNC] History sync complete!')
      archiveWriter.updateChatStats()
      onSyncComplete?.()
    }
  })

  // Fallback: capture chats that arrive via upsert events
  sock.ev.on('chats.upsert', (chats) => {
    if (chats.length > 0) {
      console.log(`[CHATS] Received ${chats.length} chats via upsert`)
      for (const chat of chats) {
        try {
          archiveWriter.writeSyncBatch(
            {
              messages: [],
              chats: [chat],
              contacts: [],
              isLatest: false,
              progress: 0,
              syncType: undefined,
            },
            source,
          )
        } catch { /* ignore duplicates */ }
      }
      totalSyncedChats += chats.length
    }
  })

  // Fallback: capture contacts via upsert
  sock.ev.on('contacts.upsert', (contacts) => {
    if (contacts.length > 0) {
      console.log(`[CONTACTS] Received ${contacts.length} contacts via upsert`)
      for (const contact of contacts) {
        try {
          archiveWriter.writeSyncBatch(
            {
              messages: [],
              chats: [],
              contacts: [contact],
              isLatest: false,
              progress: 0,
              syncType: undefined,
            },
            source,
          )
        } catch { /* ignore duplicates */ }
      }
      totalSyncedContacts += contacts.length
    }
  })

  // Live messages (new messages + historical via append)
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type === 'append') {
      // 'append' type often carries historical messages
      console.log(`[HISTORY] Received ${messages.length} historical messages via append`)
    }

    let saved = 0
    for (const msg of messages) {
      const ok = archiveWriter.writeLiveMessage(msg, source)
      if (ok) saved++

      if (ok && type === 'notify') {
        const text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || '[media]'
        const sender = msg.pushName || msg.key.remoteJid || 'unknown'
        const dir = msg.key.fromMe ? 'sent' : 'received'
        console.log(`[MSG] ${dir}: ${sender}: ${text.slice(0, 80)}`)
      }

      // Fire-and-forget media download for live and recent historical messages
      if (ok && (type === 'notify' || type === 'append') && msg.message) {
        const hasMedia = msg.message.imageMessage
          || msg.message.videoMessage
          || msg.message.audioMessage
          || msg.message.documentMessage
          || msg.message.stickerMessage
        if (hasMedia) {
          mediaDownloader.download(msg).then((result) => {
            if (result) {
              updateMediaPath.run(result.localPath, msg.key.id)
              console.log(`[MEDIA] Downloaded: ${result.localPath}`)
            }
          }).catch(() => { /* logged inside download */ })
        }
      }
    }

    if (saved > 0) {
      totalSyncedMessages += saved
      qrServer.updateStats({ totalMessages: totalSyncedMessages })
    }
  })

  // Metadata enrichment handlers
  sock.ev.on('contacts.update', (updates) => {
    for (const update of updates) {
      if (!update.id) continue
      const metadata: ContactMetadata = {
        about: (update as Record<string, unknown>).status as string | undefined ?? null,
        profilePictureUrl: (update as Record<string, unknown>).imgUrl as string | undefined ?? null,
        isBusiness: (update as Record<string, unknown>).isBusiness === true,
        businessName: (update as Record<string, unknown>).verifiedName as string | undefined
          ?? (update as Record<string, unknown>).name as string | undefined ?? null,
        verifiedName: (update as Record<string, unknown>).verifiedName as string | undefined ?? null,
      }
      archiveWriter.upsertContactMetadata(update.id, metadata)
    }
  })

  sock.ev.on('chats.update', (updates) => {
    for (const update of updates) {
      if (!update.id) continue
      const raw = update as Record<string, unknown>
      const flags = {
        archived: update.archived === true,
        pinned: update.pinned != null,
        muted: raw.mute != null && Number(raw.mute) > 0,
      }
      archiveWriter.updateChatFlags(update.id, flags)
    }
  })

  sock.ev.on('groups.update', (updates) => {
    for (const update of updates) {
      if (!update.id) continue
      const metadata: ChatMetadata = {
        subject: update.subject ?? null,
        subjectOwner: update.subjectOwner ?? null,
        subjectTime: update.subjectTime ? new Date(update.subjectTime * 1000).toISOString() : null,
        description: update.desc ?? null,
        descriptionOwner: update.descOwner ?? null,
        restrict: update.restrict === true,
        announce: update.announce === true,
      }
      archiveWriter.upsertChatMetadata(update.id, metadata)
    }
  })

  sock.ev.on('group-participants.update', ({ id, participants, action, author }) => {
    for (const participant of participants) {
      const jid = typeof participant === 'string' ? participant : (participant as { id: string }).id
      if (action === 'add') {
        archiveWriter.upsertParticipant(id, jid, 'member', author ?? undefined)
      } else if (action === 'remove') {
        archiveWriter.deactivateParticipant(id, jid)
      } else if (action === 'promote') {
        archiveWriter.updateParticipantRole(id, jid, 'admin')
      } else if (action === 'demote') {
        archiveWriter.updateParticipantRole(id, jid, 'member')
      }
    }
  })

  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (!key.id) continue
      if (update.message) {
        const newText = update.message.conversation
          || update.message.extendedTextMessage?.text
        archiveWriter.updateMessageEdited(key.id, new Date().toISOString(), newText || undefined)
      }
      if (update.messageStubType === WAMessageStubType.REVOKE) {
        archiveWriter.updateMessageDeleted(key.id)
      }
    }
  })

  sock.ev.on('messages.reaction', (reactions) => {
    for (const { key, reaction } of reactions) {
      if (!key.id || !reaction.key?.participant) continue
      archiveWriter.upsertReaction(
        key.id,
        reaction.key.participant,
        reaction.text || '',
        reaction.key.id ? new Date().toISOString() : undefined,
      )
    }
  })

  return sock
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function enrichMetadata(
  sock: WASocket,
  db: Database.Database,
  archiveWriter: ArchiveWriter,
): Promise<void> {
  await delay(5000)
  console.log('[ENRICH] Starting metadata enrichment...')

  // Enrich groups
  const groups = db.prepare("SELECT id FROM chats WHERE chat_type = 'group'").all() as { id: string }[]
  let groupsDone = 0

  for (const { id } of groups) {
    try {
      const meta = await sock.groupMetadata(id)
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
      archiveWriter.upsertChatMetadata(id, chatMeta)

      if (meta.participants) {
        for (const p of meta.participants) {
          const role = p.admin === 'superadmin' ? 'superadmin' : p.admin === 'admin' ? 'admin' : 'member'
          archiveWriter.upsertParticipant(id, p.id, role)
        }
      }

      groupsDone++
      if (groupsDone % 10 === 0) {
        console.log(`[ENRICH] Groups: ${groupsDone}/${groups.length}`)
      }
    } catch {
      // Group may no longer exist or we lack access
    }
    await delay(500)
  }

  console.log(`[ENRICH] Groups: ${groupsDone}/${groups.length} completed`)

  // Enrich contacts
  const contacts = db.prepare('SELECT id FROM contacts').all() as { id: string }[]
  let contactsDone = 0

  for (const { id } of contacts) {
    try {
      const statusResult = await sock.fetchStatus(id)
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
        profilePicUrl = await sock.profilePictureUrl(id, 'image') ?? null
      } catch {
        // No profile picture available
      }

      archiveWriter.upsertContactMetadata(id, {
        about: statusText,
        profilePictureUrl: profilePicUrl,
        isBusiness: false,
        businessName: null,
        verifiedName: null,
      })

      contactsDone++
      if (contactsDone % 25 === 0) {
        console.log(`[ENRICH] Contacts: ${contactsDone}/${contacts.length}`)
      }
    } catch {
      // Contact may not exist or status unavailable
    }
    await delay(500)
  }

  console.log(`[ENRICH] Contacts: ${contactsDone}/${contacts.length} completed`)
  console.log('[ENRICH] Metadata enrichment finished')
}
