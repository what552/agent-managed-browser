import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { BrowserContext, Page } from 'playwright-core'

export interface SessionInfo {
  id: string
  profile: string
  headless: boolean
  createdAt: string
  agentId?: string
  /** 'live' = browser running; 'zombie' = metadata only (browser not started) */
  state: 'live' | 'zombie'
}

export interface LiveSession extends SessionInfo {
  context: BrowserContext | null
  page: Page | null
}

export class SessionRegistry {
  private sessions = new Map<string, LiveSession>()
  private stateFile: string

  constructor(dataDir: string) {
    this.stateFile = path.join(dataDir, 'sessions.json')
    fs.mkdirSync(dataDir, { recursive: true })
  }

  /** Load persisted session metadata from previous daemon run. */
  loadPersistedSessions(): void {
    if (!fs.existsSync(this.stateFile)) return
    try {
      const raw = fs.readFileSync(this.stateFile, 'utf8')
      const data = JSON.parse(raw) as SessionInfo[]
      if (!Array.isArray(data)) return
      for (const info of data) {
        // Register as zombie — profile is on disk, browser not running
        this.sessions.set(info.id, { ...info, state: 'zombie', context: null, page: null })
      }
    } catch {
      // Corrupt state file — ignore, start fresh
    }
  }

  private persist(): void {
    const infos: SessionInfo[] = Array.from(this.sessions.values()).map(
      ({ context: _c, page: _p, ...info }) => info,
    )
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(infos, null, 2))
    } catch {
      // non-critical
    }
  }

  create(opts: { profile?: string; headless?: boolean; agentId?: string }): string {
    const id = 'sess_' + crypto.randomBytes(6).toString('hex')
    const info: SessionInfo = {
      id,
      profile: opts.profile ?? 'default',
      headless: opts.headless ?? true,
      createdAt: new Date().toISOString(),
      agentId: opts.agentId,
      state: 'zombie', // becomes 'live' after attach()
    }
    this.sessions.set(id, { ...info, context: null, page: null })
    this.persist()
    return id
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
