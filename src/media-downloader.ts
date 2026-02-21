import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import {
  downloadMediaMessage,
  extensionForMediaMessage,
  type WAMessage,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import {
  verifySha256,
  extractMediaCrypto,
  downloadAndDecryptMedia,
} from './media-crypto.js'

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

      // Extract crypto metadata for verification
      const crypto = extractMediaCrypto(msg.message as Record<string, unknown>)

      // Step 1: Try Baileys' built-in download (streaming decrypt)
      let buffer = await downloadMediaMessage(msg, 'buffer', {}, ctx)

      // Step 2: Verify SHA256 if we have the expected hash
      if (crypto?.fileSha256) {
        const isValid = verifySha256(buffer as Buffer, crypto.fileSha256)

        if (!isValid) {
          console.warn(
            `[MEDIA] SHA256 mismatch for ${messageId} — Baileys streaming decrypt produced corrupt output. Falling back to whole-buffer decryption.`,
          )

          // Step 3: Fallback — download encrypted from CDN and decrypt manually
          buffer = await downloadAndDecryptMedia(
            crypto.mediaKey,
            crypto.directPath,
            crypto.url,
            crypto.mediaType,
            crypto.fileSha256,
          )
        }
      }

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
