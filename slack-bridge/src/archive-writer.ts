import type Database from 'better-sqlite3'
import type { Statements } from './db.js'

export interface SlackMessage {
  readonly ts: string
  readonly channelId: string
  readonly userId?: string
  readonly text?: string
  readonly threadTs?: string
  readonly type?: string
  readonly subtype?: string
  readonly edited?: { ts: string }
  readonly files?: ReadonlyArray<{ url_private?: string; name?: string }>
  readonly raw?: unknown
}

export interface SlackChannel {
  readonly id: string
  readonly name?: string
  readonly type: 'channel' | 'im' | 'mpim' | 'group'
  readonly topic?: string
  readonly purpose?: string
  readonly memberCount?: number
  readonly isArchived?: boolean
  readonly created?: number
}

export interface SlackUser {
  readonly id: string
  readonly name?: string
  readonly displayName?: string
  readonly realName?: string
  readonly email?: string
  readonly isBot?: boolean
  readonly raw?: unknown
}

export function createArchiveWriter(db: Database.Database, stmts: Statements) {
  function writeMessage(msg: SlackMessage): boolean {
    try {
      const fileUrls = msg.files
        ? msg.files.map(f => f.url_private || '').filter(Boolean).join(',')
        : null

      stmts.insertMessage.run(
        msg.ts,
        msg.channelId,
        msg.userId || null,
        msg.text || null,
        parseFloat(msg.ts),
        msg.threadTs || null,
        msg.type || 'message',
        msg.subtype || null,
        msg.edited ? 1 : 0,
        msg.files && msg.files.length > 0 ? 1 : 0,
        fileUrls,
        JSON.stringify(msg.raw || msg),
      )

      const timestamp = Math.floor(parseFloat(msg.ts))
      stmts.updateChannelLastMessage.run(timestamp, msg.channelId, timestamp)

      return true
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('UNIQUE'))) {
        console.error(`[ARCHIVE] Error saving message ${msg.ts}:`, err)
      }
      return false
    }
  }

  function writeMessages(messages: readonly SlackMessage[]): number {
    let count = 0
    const run = db.transaction(() => {
      for (const msg of messages) {
        if (writeMessage(msg)) {
          count++
        }
      }
    })
    run()
    return count
  }

  function writeChannel(channel: SlackChannel): boolean {
    try {
      stmts.upsertChannel.run(
        channel.id,
        channel.name || null,
        channel.type,
        channel.topic || null,
        channel.purpose || null,
        channel.memberCount || 0,
        channel.isArchived ? 1 : 0,
        channel.created || null,
        null,
      )
      return true
    } catch (err) {
      console.error(`[ARCHIVE] Error saving channel ${channel.id}:`, err)
      return false
    }
  }

  function writeChannels(channels: readonly SlackChannel[]): number {
    let count = 0
    const run = db.transaction(() => {
      for (const channel of channels) {
        if (writeChannel(channel)) {
          count++
        }
      }
    })
    run()
    return count
  }

  function writeUser(user: SlackUser): boolean {
    try {
      const now = Math.floor(Date.now() / 1000)
      stmts.upsertUser.run(
        user.id,
        user.name || null,
        user.displayName || null,
        user.realName || null,
        user.email || null,
        user.isBot ? 1 : 0,
        now,
        now,
        JSON.stringify(user.raw || user),
      )
      return true
    } catch (err) {
      console.error(`[ARCHIVE] Error saving user ${user.id}:`, err)
      return false
    }
  }

  function writeUsers(users: readonly SlackUser[]): number {
    let count = 0
    const run = db.transaction(() => {
      for (const user of users) {
        if (writeUser(user)) {
          count++
        }
      }
    })
    run()
    return count
  }

  return {
    writeMessage,
    writeMessages,
    writeChannel,
    writeChannels,
    writeUser,
    writeUsers,
  }
}

export type ArchiveWriter = ReturnType<typeof createArchiveWriter>
