import crypto from 'crypto'
import path from 'path'
import { chromium, BrowserContext, Page } from 'playwright-core'
import { SessionRegistry } from '../daemon/session'
import { DaemonConfig, profilesDir } from '../daemon/config'

export interface PageInfo {
  page_id: string
  url: string
  active: boolean
}

interface SessionPageState {
  pages: Map<string, Page>
  activePageId: string
}

export class BrowserManager {
  private contexts = new Map<string, { context: BrowserContext; page: Page }>()
  /** Per-session multi-page tracking */
  private sessionPages = new Map<string, SessionPageState>()

  constructor(
    private registry: SessionRegistry,
    private config: DaemonConfig,
  ) {}

  private newPageId(): string {
    return 'page_' + crypto.randomBytes(4).toString('hex')
  }

  async launchSession(
    sessionId: string,
    opts: { profile?: string; headless?: boolean },
  ): Promise<void> {
    const profile = opts.profile ?? 'default'
    const headless = opts.headless ?? true
    const userDataDir = path.join(profilesDir(this.config), profile)

    const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
      headless,
      acceptDownloads: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
      ],
      viewport: { width: 1280, height: 720 },
    })

    const page = context.pages()[0] ?? (await context.newPage())
    const pageId = this.newPageId()
    this.contexts.set(sessionId, { context, page })
    this.sessionPages.set(sessionId, {
      pages: new Map([[pageId, page]]),
      activePageId: pageId,
    })
    this.registry.attach(sessionId, context, page)
  }

  // ---------------------------------------------------------------------------
  // Multi-page management (T03)
  // ---------------------------------------------------------------------------

  async createPage(sessionId: string): Promise<{ page_id: string; url: string }> {
    const entry = this.contexts.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    const page = await entry.context.newPage()
    const pageId = this.newPageId()
    const state = this.sessionPages.get(sessionId)!
    state.pages.set(pageId, page)
    return { page_id: pageId, url: page.url() }
  }

  listPages(sessionId: string): PageInfo[] {
    const state = this.sessionPages.get(sessionId)
    if (!state) return []
    return Array.from(state.pages.entries()).map(([page_id, page]) => ({
      page_id,
      url: page.url(),
      active: page_id === state.activePageId,
    }))
  }

  switchPage(sessionId: string, pageId: string): void {
    const state = this.sessionPages.get(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)
    if (!state.pages.has(pageId)) throw new Error(`Page ${pageId} not found in session ${sessionId}`)
    state.activePageId = pageId
    const page = state.pages.get(pageId)!
    const entry = this.contexts.get(sessionId)!
    this.contexts.set(sessionId, { ...entry, page })
    this.registry.attach(sessionId, entry.context, page)
  }

  async closePage(sessionId: string, pageId: string): Promise<void> {
    const state = this.sessionPages.get(sessionId)
    if (!state) return
    const page = state.pages.get(pageId)
    if (!page) return
    await page.close()
    state.pages.delete(pageId)
    // If closed the active page, switch to first remaining
    if (state.activePageId === pageId) {
      const remaining = Array.from(state.pages.keys())
      if (remaining.length > 0) {
        this.switchPage(sessionId, remaining[0])
      }
    }
  }

  getActivePageId(sessionId: string): string | undefined {
    return this.sessionPages.get(sessionId)?.activePageId
  }

  // ---------------------------------------------------------------------------
  // Mode switch (headless ↔ headed)
  // ---------------------------------------------------------------------------

  async switchMode(sessionId: string, headed: boolean): Promise<void> {
    const existing = this.contexts.get(sessionId)
    if (!existing) throw new Error(`Session ${sessionId} not found`)

    const s = this.registry.get(sessionId)!

    // Preserve current URL so we can restore it after relaunch (avoids about:blank)
    const currentUrl = existing.page.url()
    const urlToRestore = currentUrl && currentUrl !== 'about:blank' ? currentUrl : null

    await existing.context.close()
    this.contexts.delete(sessionId)
    this.sessionPages.delete(sessionId)

    await this.launchSession(sessionId, { profile: s.profile, headless: !headed })
    // Persist updated headless flag (launchSession/attach spreads old value)
    this.registry.updateHeadless(sessionId, !headed)

    // Restore the page to its previous URL after relaunch
    if (urlToRestore) {
      const relaunched = this.contexts.get(sessionId)
      if (relaunched) {
        try { await relaunched.page.goto(urlToRestore, { waitUntil: 'load' }) } catch { /* ignore */ }
      }
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const entry = this.contexts.get(sessionId)
    if (entry) {
      await entry.context.close()
      this.contexts.delete(sessionId)
      this.sessionPages.delete(sessionId)
    }
  }
}
