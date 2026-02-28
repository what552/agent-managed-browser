import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { BrowserContext, Page } from 'playwright-core'

// ---------------------------------------------------------------------------
// AES-256-GCM helpers for encrypted sessions.json
// ---------------------------------------------------------------------------

interface EncryptedEnvelope {
  v: 1
  alg: 'aes-256-gcm'
  iv: string   // 12-byte nonce, hex
  tag: string  // 16-byte auth tag, hex
  ct: string   // ciphertext, hex
}

/** Resolve raw env-var string to a 32-byte Buffer, or throw on bad length. */
export function resolveEncryptionKey(raw: string): Buffer {
  // Prefer base64 (44 chars for 32 bytes); fall back to hex (64 chars)
  const b64 = Buffer.from(raw, 'base64')
  if (b64.length === 32) return b64
  const hex = Buffer.from(raw, 'hex')
  if (hex.length === 32) return hex
  throw new Error(
    'AGENTMB_ENCRYPTION_KEY must be exactly 32 bytes — provide as base64 (44 chars) or hex (64 chars)',
  )
}

function encryptSessions(data: SessionInfo[], key: Buffer): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = JSON.stringify(data)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const envelope: EncryptedEnvelope = {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ct: ct.toString('hex'),
  }
  return JSON.stringify(envelope)
}

function decryptSessions(raw: string, key: Buffer): SessionInfo[] {
  const env = JSON.parse(raw) as EncryptedEnvelope
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(env.iv, 'hex'),
  )
  decipher.setAuthTag(Buffer.from(env.tag, 'hex'))
  const pt = Buffer.concat([
    decipher.update(Buffer.from(env.ct, 'hex')),
    decipher.final(),
  ]).toString('utf8')
  return JSON.parse(pt) as SessionInfo[]
}

export interface SessionInfo {
  id: string
  profile: string
  headless: boolean
  createdAt: string
  agentId?: string
  /** 'live' = browser running; 'zombie' = metadata only (browser not started) */
  state: 'live' | 'zombie'
  /** Pure Sandbox: ephemeral temp dir, cleaned up on close */
  ephemeral?: boolean
  /** Multi-channel: 'chrome' | 'msedge' | 'chromium' */
  browserChannel?: string
  /** Absolute path to custom browser executable */
  executablePath?: string
  /** 'managed' = agentmb launched browser; 'attach' = CDP connectOverCDP */
  launchMode?: 'managed' | 'attach'
  /** CDP URL for attach mode */
  cdpUrl?: string
  /** Sealed sessions block DELETE and destructive ops */
  sealed?: boolean
}

export interface LiveSession extends SessionInfo {
  context: BrowserContext | null
  page: Page | null
}

export class SessionRegistry {
  private sessions = new Map<string, LiveSession>()
  private stateFile: string
  private encryptionKey?: Buffer

  constructor(dataDir: string, encryptionKeyStr?: string) {
    this.stateFile = path.join(dataDir, 'sessions.json')
    fs.mkdirSync(dataDir, { recursive: true })
    if (encryptionKeyStr) {
      this.encryptionKey = resolveEncryptionKey(encryptionKeyStr)
    }
  }

  /** Load persisted session metadata from previous daemon run. */
  loadPersistedSessions(): void {
    if (!fs.existsSync(this.stateFile)) return
    try {
      const raw = fs.readFileSync(this.stateFile, 'utf8')
      let data: SessionInfo[]

      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        // Plain JSON (no encryption configured, or pre-encryption file)
        data = parsed
      } else if (parsed.v === 1 && parsed.ct) {
        // Encrypted envelope
        if (!this.encryptionKey) {
          process.stderr.write(
            '[agentmb] sessions.json is encrypted but AGENTMB_ENCRYPTION_KEY is not set — skipping session load\n',
          )
          return
        }
        data = decryptSessions(raw, this.encryptionKey)
      } else {
        return // unknown format, start fresh
      }

      for (const info of data) {
        // Register as zombie — profile is on disk, browser not running
        this.sessions.set(info.id, { ...info, state: 'zombie', context: null, page: null })
      }
    } catch {
      // Corrupt or tampered state file — ignore, start fresh
    }
  }

  private persist(): void {
    const infos: SessionInfo[] = Array.from(this.sessions.values()).map(
      ({ context: _c, page: _p, ...info }) => info,
    )
    try {
      const content = this.encryptionKey
        ? encryptSessions(infos, this.encryptionKey)
        : JSON.stringify(infos, null, 2)
      fs.writeFileSync(this.stateFile, content)
    } catch {
      // non-critical
    }
  }

  create(opts: {
    profile?: string
    headless?: boolean
    agentId?: string
    ephemeral?: boolean
    browserChannel?: string
    executablePath?: string
    launchMode?: 'managed' | 'attach'
    cdpUrl?: string
  }): string {
    const id = 'sess_' + crypto.randomBytes(6).toString('hex')
    const info: SessionInfo = {
      id,
      profile: opts.profile ?? 'default',
      headless: opts.headless ?? true,
      createdAt: new Date().toISOString(),
      agentId: opts.agentId,
      state: 'zombie', // becomes 'live' after attach()
      ephemeral: opts.ephemeral,
      browserChannel: opts.browserChannel,
      executablePath: opts.executablePath,
      launchMode: opts.launchMode,
      cdpUrl: opts.cdpUrl,
    }
    this.sessions.set(id, { ...info, context: null, page: null })
    this.persist()
    return id
  }

  /** Mark a session as sealed — blocks DELETE and destructive ops. */
  seal(id: string): void {
    const s = this.sessions.get(id)
    if (!s) throw new Error(`Session not found: ${id}`)
    s.sealed = true
    this.persist()
  }

  attach(id: string, context: BrowserContext, page: Page): void {
    const existing = this.sessions.get(id)
    if (!existing) throw new Error(`Session ${id} not found`)
    this.sessions.set(id, { ...existing, state: 'live', context, page })
    this.persist()
  }

  get(id: string): LiveSession | undefined {
    return this.sessions.get(id)
  }

  getOrThrow(id: string): LiveSession {
    const s = this.sessions.get(id)
    if (!s) throw new Error(`Session not found: ${id}`)
    return s
  }

  /** Get a live (browser-running) session or return an error discriminant. */
  getLive(id: string):
    | (LiveSession & { context: BrowserContext; page: Page })
    | { notFound: true }
    | { zombie: true; info: SessionInfo } {
    const s = this.sessions.get(id)
    if (!s) return { notFound: true }
    if (s.state !== 'live' || !s.page || !s.context) return { zombie: true, info: s }
    return s as LiveSession & { context: BrowserContext; page: Page }
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(({ context: _c, page: _p, ...info }) => info)
  }

  count(): number {
    return Array.from(this.sessions.values()).filter((s) => s.state === 'live').length
  }

  /** Update the headless flag in memory and persist to disk (called after mode switch). */
  updateHeadless(id: string, headless: boolean): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.headless = headless
    this.persist()
  }

  async close(id: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return
    if (s.context) {
      try { await s.context.close() } catch { /* ignore */ }
    }
    this.sessions.delete(id)
    this.persist()
  }

  /** On daemon shutdown: persist zombie metadata to disk, then close all contexts. */
  async shutdownAll(): Promise<void> {
    // 1. Mark all live sessions as zombie and persist to disk (so they survive restart)
    for (const [, s] of this.sessions) {
      if (s.state === 'live') s.state = 'zombie'
    }
    this.persist()
    // 2. Close all browser contexts
    await Promise.all(
      Array.from(this.sessions.values()).map(async (s) => {
        if (s.context) {
          try { await s.context.close() } catch { /* ignore */ }
        }
      }),
    )
    this.sessions.clear()
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.sessions.keys()).map((id) => this.close(id)))
  }
}
