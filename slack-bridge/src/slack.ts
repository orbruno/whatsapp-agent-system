import { App } from '@slack/bolt'
import type { ArchiveWriter, SlackChannel, SlackUser } from './archive-writer.js'

interface SlackAppOptions {
  readonly botToken: string
  readonly appToken: string
  readonly archiveWriter: ArchiveWriter
}

export function createSlackApp({ botToken, appToken, archiveWriter }: SlackAppOptions) {
  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  })

  app.message(async ({ message }) => {
    if (!('ts' in message) || !('channel' in message)) return

    const msg = message as Record<string, unknown>

    archiveWriter.writeMessage({
      ts: msg.ts as string,
      channelId: msg.channel as string,
      userId: (msg.user as string) || undefined,
      text: (msg.text as string) || undefined,
      threadTs: (msg.thread_ts as string) || undefined,
      type: (msg.type as string) || 'message',
      subtype: (msg.subtype as string) || undefined,
      edited: msg.edited as { ts: string } | undefined,
      files: msg.files as Array<{ url_private?: string; name?: string }> | undefined,
      raw: msg,
    })
  })

  async function syncChannels(): Promise<number> {
    console.log('[SLACK] Syncing channels...')
    const channels: SlackChannel[] = []
    let cursor: string | undefined

    do {
      const result = await app.client.conversations.list({
        token: botToken,
        types: 'public_channel,private_channel,im,mpim',
        limit: 200,
        cursor,
      })

      for (const ch of result.channels || []) {
        const type = ch.is_im ? 'im'
          : ch.is_mpim ? 'mpim'
          : ch.is_group || ch.is_private ? 'group'
          : 'channel'

        channels.push({
          id: ch.id!,
          name: ch.name || ch.id,
          type,
          topic: ch.topic?.value || undefined,
          purpose: ch.purpose?.value || undefined,
          memberCount: ch.num_members || 0,
          isArchived: ch.is_archived || false,
          created: ch.created || undefined,
        })
      }

      cursor = result.response_metadata?.next_cursor || undefined
    } while (cursor)

    const written = archiveWriter.writeChannels(channels)
    console.log(`[SLACK] Synced ${written} channels`)
    return written
  }

  async function syncUsers(): Promise<number> {
    console.log('[SLACK] Syncing users...')
    const users: SlackUser[] = []
    let cursor: string | undefined

    do {
      const result = await app.client.users.list({
        token: botToken,
        limit: 200,
        cursor,
      })

      for (const member of result.members || []) {
        if (member.deleted) continue

        users.push({
          id: member.id!,
          name: member.name || undefined,
          displayName: member.profile?.display_name || undefined,
          realName: member.real_name || member.profile?.real_name || undefined,
          email: member.profile?.email || undefined,
          isBot: member.is_bot || false,
          raw: member,
        })
      }

      cursor = result.response_metadata?.next_cursor || undefined
    } while (cursor)

    const written = archiveWriter.writeUsers(users)
    console.log(`[SLACK] Synced ${written} users`)
    return written
  }

  async function start(): Promise<void> {
    await app.start()
    console.log('[SLACK] Bolt app started (Socket Mode)')

    await syncChannels()
    await syncUsers()
  }

  async function stop(): Promise<void> {
    await app.stop()
    console.log('[SLACK] Bolt app stopped')
  }

  return {
    app,
    client: app.client,
    start,
    stop,
    syncChannels,
    syncUsers,
  }
}

export type SlackApp = ReturnType<typeof createSlackApp>
