import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import type { ArchiveWriter } from './archive-writer.js'
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
}

export async function connectWhatsApp(options: WhatsAppOptions): Promise<void> {
  const { authPath, source, archiveWriter, qrServer, mediaDownloader, updateMediaPath, onSyncComplete } = options
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
          setTimeout(() => connectWhatsApp(options), 5000)
        }
      }
    }

    if (connection === 'open') {
      qrServer.setConnected(true)
      console.log('[WA] Connected! Waiting for history sync...')
      console.log('[WA] Keep your phone on WiFi, plugged in, and WhatsApp open.')
      console.log('[WA] (This can take 5-15 minutes for large chat histories)')
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
}
