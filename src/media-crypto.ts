import { createHash, createHmac, createDecipheriv } from 'crypto'
import {
  getMediaKeys,
  getUrlFromDirectPath,
} from '@whiskeysockets/baileys/lib/Utils/messages-media.js'
import type { MediaType } from '@whiskeysockets/baileys'

const MAC_LENGTH = 10

/**
 * Compares a buffer's SHA256 against an expected hash.
 * Returns true if they match.
 */
export function verifySha256(buffer: Buffer, expectedSha256: Uint8Array): boolean {
  const actual = createHash('sha256').update(buffer).digest()
  return Buffer.from(actual).equals(Buffer.from(expectedSha256))
}

/**
 * Downloads the encrypted media file from the WhatsApp CDN as a whole buffer.
 * This avoids the streaming pipeline that can corrupt data.
 */
async function downloadEncryptedBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { Origin: 'https://web.whatsapp.com' },
  })

  if (!response.ok) {
    throw new Error(`CDN download failed: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Decrypts a WhatsApp media file from its encrypted buffer.
 *
 * Protocol:
 *   encrypted_file = [enc_payload | mac(10 bytes)]
 *   HKDF(mediaKey, salt=zeros(32), info="WhatsApp {Type} Keys") → 112 bytes
 *     → iv(16) | cipherKey(32) | macKey(32) | refKey(32)
 *   Verify: HMAC-SHA256(macKey, iv + enc_payload)[:10] == mac
 *   Decrypt: AES-256-CBC(cipherKey, iv, enc_payload)
 *   Strip PKCS7 padding
 */
export async function decryptMediaBuffer(
  encryptedData: Buffer,
  mediaKey: Uint8Array,
  mediaType: MediaType,
): Promise<Buffer> {
  // Derive keys using Baileys' HKDF (which is correct — uses Web Crypto full HKDF)
  const keys = await getMediaKeys(mediaKey, mediaType)
  const { iv, cipherKey } = keys

  if (!keys.macKey) {
    throw new Error('HKDF did not produce macKey — cannot verify integrity')
  }

  const macKey = keys.macKey

  // Split encrypted file: payload + 10-byte MAC
  const encPayload = encryptedData.subarray(0, encryptedData.length - MAC_LENGTH)
  const fileMac = encryptedData.subarray(encryptedData.length - MAC_LENGTH)

  // Verify HMAC-SHA256
  const hmac = createHmac('sha256', macKey)
  hmac.update(iv)
  hmac.update(encPayload)
  const computedMac = hmac.digest().subarray(0, MAC_LENGTH)

  if (!computedMac.equals(fileMac)) {
    throw new Error('MAC verification failed — encrypted file is corrupted or keys are wrong')
  }

  // Decrypt AES-256-CBC (whole buffer, not streaming)
  const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv)
  const decrypted = Buffer.concat([
    decipher.update(encPayload),
    decipher.final(),
  ])

  return decrypted
}

/**
 * Extracts media cryptographic metadata from a WAMessage.
 * Returns null if the message has no media or missing fields.
 */
export function extractMediaCrypto(message: Record<string, unknown>): {
  fileSha256: Uint8Array
  mediaKey: Uint8Array
  directPath: string
  url: string | null
  mediaType: MediaType
} | null {
  if (!message) return null

  const mediaTypes: Array<{ key: string; type: MediaType }> = [
    { key: 'imageMessage', type: 'image' },
    { key: 'videoMessage', type: 'video' },
    { key: 'audioMessage', type: 'audio' },
    { key: 'documentMessage', type: 'document' },
    { key: 'stickerMessage', type: 'sticker' },
  ]

  for (const { key, type } of mediaTypes) {
    const media = message[key] as Record<string, unknown> | undefined
    if (!media) continue

    const fileSha256 = media.fileSha256 as Uint8Array | undefined
    const mediaKey = media.mediaKey as Uint8Array | undefined
    const directPath = media.directPath as string | undefined

    if (!fileSha256 || !mediaKey || !directPath) continue

    return {
      fileSha256,
      mediaKey,
      directPath,
      url: (media.url as string) || null,
      mediaType: type,
    }
  }

  return null
}

/**
 * Downloads and decrypts media from CDN with full integrity verification.
 * This is the fallback path when Baileys' streaming decrypt produces corrupt output.
 */
export async function downloadAndDecryptMedia(
  mediaKey: Uint8Array,
  directPath: string,
  url: string | null,
  mediaType: MediaType,
  expectedSha256: Uint8Array,
): Promise<Buffer> {
  const downloadUrl = url?.startsWith('https://mmg.whatsapp.net/')
    ? url
    : getUrlFromDirectPath(directPath)

  console.log(`[MEDIA-CRYPTO] Downloading encrypted file from CDN...`)
  const encryptedBuffer = await downloadEncryptedBuffer(downloadUrl)
  console.log(`[MEDIA-CRYPTO] Downloaded ${encryptedBuffer.length} encrypted bytes`)

  console.log(`[MEDIA-CRYPTO] Decrypting with verified HKDF + AES-256-CBC...`)
  const decrypted = await decryptMediaBuffer(encryptedBuffer, mediaKey, mediaType)

  if (!verifySha256(decrypted, expectedSha256)) {
    throw new Error('SHA256 mismatch after manual decryption — file integrity check failed')
  }

  console.log(`[MEDIA-CRYPTO] Decryption successful, SHA256 verified (${decrypted.length} bytes)`)
  return decrypted
}
