import { resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'

export interface AppConfig {
  readonly slackBotToken: string
  readonly slackAppToken: string
  readonly httpPort: number
  readonly dbPath: string
  readonly mediaPath: string
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function loadConfig(): AppConfig {
  const config: AppConfig = {
    slackBotToken: requireEnv('SLACK_BOT_TOKEN'),
    slackAppToken: requireEnv('SLACK_APP_TOKEN'),
    httpPort: parseInt(process.env.HTTP_PORT || '3102', 10),
    dbPath: resolve(process.env.DB_PATH || './data/archive.db'),
    mediaPath: resolve(process.env.MEDIA_PATH || './data/media'),
  }

  ensureDir(resolve(config.dbPath, '..'))
  ensureDir(config.mediaPath)

  return config
}
