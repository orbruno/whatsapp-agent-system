import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'

interface MediaDownloaderOptions {
  readonly mediaDir: string
  readonly botToken: string
}

interface DownloadResult {
  readonly localPath: string
}

export function createMediaDownloader({ mediaDir, botToken }: MediaDownloaderOptions) {
  async function download(
    fileUrl: string,
    channelId: string,
    filename: string,
  ): Promise<DownloadResult | null> {
    try {
      const channelDir = join(mediaDir, channelId)
      const localPath = join(channelDir, filename)

      if (existsSync(localPath)) {
        return { localPath }
      }

      const response = await fetch(fileUrl, {
        headers: { Authorization: `Bearer ${botToken}` },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())

      if (!existsSync(channelDir)) {
        mkdirSync(channelDir, { recursive: true })
      }

      writeFileSync(localPath, buffer)

      return { localPath }
    } catch (err) {
      console.error(`[MEDIA] Failed to download ${filename}:`, (err as Error).message)
      return null
    }
  }

  return { download }
}

export type MediaDownloader = ReturnType<typeof createMediaDownloader>
