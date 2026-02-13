import { loadConfig } from './config.js'
import { initDatabase, prepareStatements } from './db.js'
import { createMediaDownloader } from './media-downloader.js'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WAMessage,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'

const DELAY_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const config = loadConfig()
  const db = initDatabase(config.dbPath)
  const stmts = prepareStatements(db)
  const downloader = createMediaDownloader({ mediaDir: config.mediaPath })

  interface PendingRow {
    id: string
    chat_id: string
    raw_json: string
  }

  const pending = stmts.getMediaPendingMessages.all() as PendingRow[]
  console.log(`[RETRY] Found ${pending.length} messages with media but no local file`)

  if (pending.length === 0) {
    db.close()
    return
  }

  console.log('[RETRY] Connecting to WhatsApp for media re-upload requests...')

  const { state, saveCreds } = await useMultiFileAuthState(config.authPath)

  const sock = makeWASocket({
    auth: state,
    browser: ['macOS', 'Bot', 'Chrome'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    printQRInTerminal: false,
    logger: pino({ level: 'warn' }),
    generateHighQualityLinkPreview: false,
    fireInitQueries: false,
  })

  sock.ev.on('creds.update', saveCreds)

  await new Promise<void>((resolve, reject) => {
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update
      if (connection === 'open') {
        console.log('[RETRY] Connected!')
        resolve()
      }
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        if (statusCode === DisconnectReason.loggedOut) {
          reject(new Error('Logged out - re-scan QR first'))
        } else {
          reject(new Error(`Disconnected with code ${statusCode}`))
        }
      }
    })
  })

  let success = 0
  let failed = 0

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i]
    const msg = JSON.parse(row.raw_json) as WAMessage

    const result = await downloader.download(msg, sock.updateMediaMessage)

    if (result) {
      stmts.updateMediaPath.run(result.localPath, row.id)
      success++
    } else {
      failed++
    }

    if ((i + 1) % 10 === 0 || i === pending.length - 1) {
      console.log(`[RETRY] ${i + 1}/${pending.length} - success: ${success}, failed: ${failed}`)
    }

    if (i < pending.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  console.log(`\n[RETRY] Done! Success: ${success}, Failed: ${failed}, Total: ${pending.length}`)

  sock.end(undefined)
  db.close()
}

main().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
