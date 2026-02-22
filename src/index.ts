import { loadConfig } from './config.js'
import { initDatabase, prepareStatements } from './db.js'
import { createArchiveWriter } from './archive-writer.js'
import { createQrServer } from './qr-server.js'
import { connectWhatsApp, type SocketHolder } from './whatsapp.js'
import { createMediaDownloader } from './media-downloader.js'
import { createApiRoutes } from './api-routes.js'

async function main() {
  const config = loadConfig()

  console.log('[INIT] WhatsApp Message Archive')
  console.log(`  Database: ${config.dbPath}`)
  console.log(`  Auth: ${config.authPath}`)
  console.log(`  Media: ${config.mediaPath}`)
  console.log(`  QR Server: http://localhost:${config.qrPort}`)
  console.log()

  const db = initDatabase(config.dbPath)
  const stmts = prepareStatements(db)
  const archiveWriter = createArchiveWriter(db, stmts)
  const qrServer = createQrServer(config.qrPort)
  const mediaDownloader = createMediaDownloader({ mediaDir: config.mediaPath })
  function printFinalStats() {
    interface StatRow { count: number }
    const messages = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as StatRow).count
    const chats = (db.prepare('SELECT COUNT(*) as count FROM chats').get() as StatRow).count
    const contacts = (db.prepare('SELECT COUNT(*) as count FROM contacts').get() as StatRow).count

    qrServer.updateStats({
      totalMessages: messages,
      totalChats: chats,
      totalContacts: contacts,
      syncProgress: 100,
    })

    console.log('\n=== Archive Stats ===')
    console.log(`  Messages:  ${messages.toLocaleString()}`)
    console.log(`  Chats:     ${chats.toLocaleString()}`)
    console.log(`  Contacts:  ${contacts.toLocaleString()}`)
    console.log('====================')
    console.log('\nHistory sync done. Live capture active.')
    console.log('New messages will be archived automatically.')
    console.log('Run `npm run stats` for detailed analytics.')
    console.log('Press Ctrl+C to stop.\n')
  }

  const socketHolder: SocketHolder = { sock: null }

  await connectWhatsApp({
    authPath: config.authPath,
    source: 'personal',
    archiveWriter,
    qrServer,
    mediaDownloader,
    updateMediaPath: stmts.updateMediaPath,
    onSyncComplete: printFinalStats,
    db,
  }, socketHolder)

  createApiRoutes(qrServer.app, db, socketHolder, archiveWriter)

  process.on('SIGINT', () => {
    console.log('\n[EXIT] Shutting down...')
    qrServer.close()
    db.close()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('\n[EXIT] Shutting down...')
    qrServer.close()
    db.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
