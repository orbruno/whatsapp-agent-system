import { loadConfig } from './config.js'
import { initDatabase, prepareStatements } from './db.js'
import { createArchiveWriter } from './archive-writer.js'
import { createSlackApp } from './slack.js'
import { createApiServer } from './api-server.js'

async function main() {
  const config = loadConfig()

  console.log('[INIT] Slack Message Archive')
  console.log(`  Database: ${config.dbPath}`)
  console.log(`  Media: ${config.mediaPath}`)
  console.log(`  HTTP API: http://localhost:${config.httpPort}`)
  console.log()

  const db = initDatabase(config.dbPath)
  const stmts = prepareStatements(db)
  const archiveWriter = createArchiveWriter(db, stmts)

  const slackApp = createSlackApp({
    botToken: config.slackBotToken,
    appToken: config.slackAppToken,
    archiveWriter,
  })

  const apiServer = createApiServer({
    db,
    port: config.httpPort,
    slackApp,
  })

  await slackApp.start()
  await apiServer.start()

  console.log('\n[READY] Slack bridge is running')
  console.log('Live message capture active.')
  console.log('Press Ctrl+C to stop.\n')

  const shutdown = async () => {
    console.log('\n[EXIT] Shutting down...')
    await slackApp.stop()
    db.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
