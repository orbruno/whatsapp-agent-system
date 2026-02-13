import { resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'

export interface AppConfig {
  readonly qrPort: number
  readonly dbPath: string
  readonly authPath: string
  readonly mediaPath: string
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export function loadConfig(): AppConfig {
  const config: AppConfig = {
    qrPort: parseInt(process.env.QR_PORT || '3100', 10),
    dbPath: resolve(process.env.DB_PATH || './data/archive.db'),
    authPath: resolve(process.env.AUTH_PATH || './data/auth_info'),
    mediaPath: resolve(process.env.MEDIA_PATH || './data/media'),
  }

  ensureDir(resolve(config.dbPath, '..'))
  ensureDir(config.authPath)
  ensureDir(config.mediaPath)

  return config
}
