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
}

export interface LiveSession extends SessionInfo {
  context: BrowserContext
  page: Page
}

export class SessionRegistry {
  private sessions = new Map<string, LiveSession>()
  private stateFile: string

  constructor(dataDir: string) {
    this.stateFile = path.join(dataDir, 'sessions.json')
    fs.mkdirSync(dataDir, { recursive: true })
  }

  create(opts: { profile?: string; headless?: boolean; agentId?: string }): string {
    const id = 'sess_' + crypto.randomBytes(6).toString('hex')
    // LiveSession will be populated by BrowserManager.attachSession()
    // This registers the metadata slot
    const info: SessionInfo = {
      id,
      profile: opts.profile ?? 'default',
      headless: opts.headless ?? true,
      createdAt: new Date().toISOString(),
      agentId: opts.agentId,
    }
    // We store the info but context/page are attached later
    this.sessions.set(id, info as LiveSession)
    return id
  }

  attach(id: string, context: BrowserContext, page: Page): void {
    const existing = this.sessions.get(id)
    if (!existing) throw new Error(`Session ${id} not found`)
    this.sessions.set(id, { ...existing, context, page })
  }

  get(id: string): LiveSession | undefined {
    return this.sessions.get(id)
  }

  getOrThrow(id: string): LiveSession {
    const s = this.sessions.get(id)
    if (!s) throw new Error(`Session not found: ${id}`)
    return s
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(({ context: _c, page: _p, ...info }) => info)
  }

  count(): number {
    return this.sessions.size
  }

  async close(id: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return
    if (s.context) {
      try {
        await s.context.close()
      } catch {
        // ignore
      }
    }
    this.sessions.delete(id)
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.sessions.keys()).map((id) => this.close(id)))
  }
}
