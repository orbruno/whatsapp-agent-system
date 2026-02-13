import type { proto } from '@whiskeysockets/baileys'

export interface ParsedMessage {
  readonly id: string
  readonly chatId: string
  readonly contactId: string | null
  readonly direction: 'sent' | 'received'
  readonly messageType: string
  readonly content: string | null
  readonly timestamp: number
  readonly senderName: string | null
  readonly replyToId: string | null
  readonly isForwarded: boolean
  readonly mediaMimeType: string | null
  readonly mediaSizeBytes: number | null
  readonly mediaFilename: string | null
  readonly mediaDurationSeconds: number | null
}

function extractText(msg: proto.IWebMessageInfo): string | null {
  const m = msg.message
  if (!m) return null

  return (
    m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || m.buttonsResponseMessage?.selectedDisplayText
    || m.listResponseMessage?.title
    || m.templateButtonReplyMessage?.selectedDisplayText
    || null
  )
}

function detectMessageType(msg: proto.IWebMessageInfo): string {
  const m = msg.message
  if (!m) return 'unknown'

  if (m.conversation || m.extendedTextMessage) return 'text'
  if (m.imageMessage) return 'image'
  if (m.videoMessage) return 'video'
  if (m.audioMessage) return 'audio'
  if (m.documentMessage) return 'document'
  if (m.stickerMessage) return 'sticker'
  if (m.contactMessage || m.contactsArrayMessage) return 'contact'
  if (m.locationMessage || m.liveLocationMessage) return 'location'
  if (m.reactionMessage) return 'reaction'
  if (m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3) return 'poll'
  if (m.protocolMessage) return 'system'
  if (m.buttonsMessage || m.listMessage || m.templateMessage) return 'interactive'

  return 'other'
}

function extractMediaInfo(msg: proto.IWebMessageInfo) {
  const m = msg.message
  if (!m) return { mime: null, size: null, filename: null, duration: null }

  const media =
    m.imageMessage
    || m.videoMessage
    || m.audioMessage
    || m.documentMessage
    || m.stickerMessage

  if (!media) return { mime: null, size: null, filename: null, duration: null }

  return {
    mime: (media as { mimetype?: string }).mimetype || null,
    size: (media as { fileLength?: number | Long }).fileLength
      ? Number((media as { fileLength: number | Long }).fileLength)
      : null,
    filename: (media as { fileName?: string }).fileName || null,
    duration: (media as { seconds?: number }).seconds || null,
  }
}

function extractReplyId(msg: proto.IWebMessageInfo): string | null {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.audioMessage?.contextInfo
    || msg.message?.documentMessage?.contextInfo

  return ctx?.stanzaId || null
}

function isForwarded(msg: proto.IWebMessageInfo): boolean {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo

  return ctx?.isForwarded === true
}

export function parseMessage(msg: proto.IWebMessageInfo): ParsedMessage | null {
  const key = msg.key
  if (!key || !key.remoteJid || !key.id) return null

  const remoteJid = key.remoteJid
  const id = key.id
  const fromMe = key.fromMe ?? false
  const participant = key.participant || remoteJid
  const media = extractMediaInfo(msg)
  const ts = msg.messageTimestamp
  const timestamp = typeof ts === 'number' ? ts : Number(ts)

  return {
    id,
    chatId: remoteJid,
    contactId: fromMe ? null : participant,
    direction: fromMe ? 'sent' : 'received',
    messageType: detectMessageType(msg),
    content: extractText(msg),
    timestamp,
    senderName: msg.pushName || null,
    replyToId: extractReplyId(msg),
    isForwarded: isForwarded(msg),
    mediaMimeType: media.mime,
    mediaSizeBytes: media.size,
    mediaFilename: media.filename,
    mediaDurationSeconds: media.duration,
  }
}
