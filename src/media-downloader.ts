import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import {
  downloadMediaMessage,
  extensionForMediaMessage,
  type WAMessage,
} from '@whiskeysockets/baileys'
import pino from 'pino'

interface MediaDownloaderOptions {
  readonly mediaDir: string
}

interface DownloadResult {
  readonly localPath: string
}

type ReuploadRequest = (msg: WAMessage) => Promise<WAMessage>

const logger = pino({ level: 'warn' })

export function createMediaDownloader({ mediaDir }: MediaDownloaderOptions) {
  async function download(
    msg: WAMessage,
    reuploadRequest?: ReuploadRequest,
  ): Promise<DownloadResult | null> {
    try {
      const chatId = msg.key?.remoteJid
      const messageId = msg.key?.id
      if (!chatId || !messageId || !msg.message) return null

      let ext: string
      try {
        ext = extensionForMediaMessage(msg.message)
      } catch {
        ext = 'bin'
      }

      const chatDir = join(mediaDir, chatId)
      const filename = `${messageId}.${ext}`
      const localPath = join(chatDir, filename)

      if (existsSync(localPath)) {
        return { localPath }
      }

      const ctx = reuploadRequest
        ? { reuploadRequest, logger }
        : undefined

      const buffer = await downloadMediaMessage(msg, 'buffer', {}, ctx)

      if (!existsSync(chatDir)) {
        mkdirSync(chatDir, { recursive: true })
      }

      writeFileSync(localPath, buffer)

      return { localPath }
    } catch (err) {
      const id = msg.key?.id ?? 'unknown'
      console.error(`[MEDIA] Failed to download ${id}:`, (err as Error).message)
      return null
    }
  }

  return { download }
}

export type MediaDownloader = ReturnType<typeof createMediaDownloader>
