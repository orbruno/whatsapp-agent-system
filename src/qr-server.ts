import express from 'express'
import QRCode from 'qrcode'

export interface QrServerState {
  qrDataUrl: string
  connected: boolean
  syncProgress: number
  totalMessages: number
  totalChats: number
  totalContacts: number
}

export function createQrServer(port: number) {
  const app = express()
  app.use(express.json())

  const state: QrServerState = {
    qrDataUrl: '',
    connected: false,
    syncProgress: 0,
    totalMessages: 0,
    totalChats: 0,
    totalContacts: 0,
  }

  app.get('/', (_req, res) => {
    if (state.connected) {
      res.send(connectedPage(state))
    } else if (state.qrDataUrl) {
      res.send(qrPage(state.qrDataUrl))
    } else {
      res.send(waitingPage())
    }
  })

  app.get('/status', (_req, res) => {
    res.json(state)
  })

  const server = app.listen(port, () => {
    console.log(`[QR] Server at http://localhost:${port}`)
  })

  async function updateQr(qr: string): Promise<void> {
    state.qrDataUrl = await QRCode.toDataURL(qr, { width: 400 })
    console.log(`[QR] New QR code - scan at http://localhost:${port}`)
  }

  function setConnected(connected: boolean): void {
    state.connected = connected
  }

  function updateStats(stats: Partial<QrServerState>): void {
    Object.assign(state, stats)
  }

  function close(): void {
    server.close()
  }

  return { app, updateQr, setConnected, updateStats, close }
}

function waitingPage(): string {
  return `<!DOCTYPE html>
<html><head><title>WhatsApp Connect</title>
<meta http-equiv="refresh" content="3">
<style>body{font-family:system-ui;text-align:center;padding:60px;background:#111;color:#fff}</style>
</head><body>
<h1>Waiting for QR code...</h1>
<p>The connection is initializing. This page refreshes automatically.</p>
</body></html>`
}

function qrPage(qrDataUrl: string): string {
  return `<!DOCTYPE html>
<html><head><title>WhatsApp Connect</title>
<meta http-equiv="refresh" content="15">
<style>body{font-family:system-ui;text-align:center;padding:40px;background:#111;color:#fff}
img{border-radius:12px;margin:20px}</style>
</head><body>
<h1>Scan with WhatsApp</h1>
<p>Open WhatsApp > Settings > Linked Devices > Link a Device</p>
<img src="${qrDataUrl}" alt="QR Code" />
<p style="color:#888">QR refreshes automatically. Keep this page open.</p>
</body></html>`
}

function connectedPage(state: QrServerState): string {
  return `<!DOCTYPE html>
<html><head><title>WhatsApp Connected</title>
<meta http-equiv="refresh" content="5">
<style>body{font-family:system-ui;text-align:center;padding:40px;background:#111;color:#fff}
.stat{display:inline-block;margin:20px;padding:20px;background:#222;border-radius:12px;min-width:120px}
.stat h2{color:#25D366;margin:0;font-size:2em}
.stat p{margin:5px 0 0;color:#888}</style>
</head><body>
<h1 style="color:#25D366">Connected</h1>
<p>History sync: ${state.syncProgress}%</p>
<div>
  <div class="stat"><h2>${state.totalMessages.toLocaleString()}</h2><p>Messages</p></div>
  <div class="stat"><h2>${state.totalChats.toLocaleString()}</h2><p>Chats</p></div>
  <div class="stat"><h2>${state.totalContacts.toLocaleString()}</h2><p>Contacts</p></div>
</div>
<p style="color:#888">Stats refresh automatically.</p>
</body></html>`
}
