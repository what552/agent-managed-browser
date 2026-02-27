import crypto from 'crypto'
import path from 'path'
import { chromium, BrowserContext, Page, Route, CDPSession } from 'playwright-core'
import { SessionRegistry } from '../daemon/session'
import { DaemonConfig, profilesDir } from '../daemon/config'

// ---------------------------------------------------------------------------
// R07-T16/T17: Console log + page error ring buffer types
// ---------------------------------------------------------------------------

export interface ConsoleEntry {
  ts: string
  type: string  // 'log' | 'warn' | 'error' | 'info' | 'debug' | ...
  text: string
  url: string
}

export interface PageErrorEntry {
  ts: string
  message: string
  url: string
}

// ---------------------------------------------------------------------------
// R07-C04-T22: Dialog observability
// ---------------------------------------------------------------------------

export interface DialogEntry {
  ts: string
  type: string  // 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  message: string
  default_value: string
  url: string
  action: 'dismissed'  // auto-action taken
}

// ---------------------------------------------------------------------------
// R07-T13: Snapshot store types
// ---------------------------------------------------------------------------

export interface SnapshotElement {
  ref_id: string
  element_id: string
  tag: string
  role: string
  text: string
  name: string
  placeholder: string
  href: string
  type: string
  overlay_blocked: boolean
  rect: { x: number; y: number; width: number; height: number }
}

export interface SnapshotEntry {
  snapshot_id: string
  page_rev: number
  url: string
  elements: SnapshotElement[]
  created_at: number
}

export interface PageInfo {
  page_id: string
  url: string
  active: boolean
}

interface SessionPageState {
  pages: Map<string, Page>
  activePageId: string
}

// ---------------------------------------------------------------------------
// Network route management (T07)
// ---------------------------------------------------------------------------

export interface RouteMockConfig {
  status?: number
  headers?: Record<string, string>
  body?: string
  content_type?: string
}

interface RouteEntry {
  pattern: string
  mock: RouteMockConfig
  handler: (route: Route) => Promise<void>
}

export class BrowserManager {
  private contexts = new Map<string, { context: BrowserContext; page: Page }>()
  /** Per-session multi-page tracking */
  private sessionPages = new Map<string, SessionPageState>()
  /** Per-session network route mocks */
  private sessionRoutes = new Map<string, Map<string, RouteEntry>>()
  /** Per-session acceptDownloads setting (default: false) */
  private sessionAcceptDownloads = new Map<string, boolean>()
  /** R07-T13: page revision counter — incremented on main-frame navigation */
  private sessionPageRevs = new Map<string, number>()
  /** R07-T13: snapshot store — keyed by sessionId → snapshotId → SnapshotEntry */
  private sessionSnapshots = new Map<string, Map<string, SnapshotEntry>>()
  private readonly MAX_SNAPSHOTS = 5
  /** R07-T16: console log ring buffer (max 500/session) */
  private sessionConsoleLog = new Map<string, ConsoleEntry[]>()
  private readonly MAX_CONSOLE = 500
  /** R07-T17: page error ring buffer (max 100/session) */
  private sessionPageErrors = new Map<string, PageErrorEntry[]>()
  private readonly MAX_ERRORS = 100
  /** R07-C04-T22: JS dialog ring buffer (max 50/session, auto-dismissed) */
  private sessionDialogs = new Map<string, DialogEntry[]>()
  private readonly MAX_DIALOGS = 50
  /** R07-C04-T25: CDP sessions for network-condition emulation */
  private sessionCdpSessions = new Map<string, CDPSession>()

  constructor(
    private registry: SessionRegistry,
    private config: DaemonConfig,
  ) {}

  // ---------------------------------------------------------------------------
  // R07-T13: page_rev + snapshot management
  // ---------------------------------------------------------------------------

  getPageRev(sessionId: string): number {
    return this.sessionPageRevs.get(sessionId) ?? 0
  }

  /** Called internally on main-frame navigation; clears all snapshots. */
  private incrementPageRev(sessionId: string): void {
    const current = this.sessionPageRevs.get(sessionId) ?? 0
    this.sessionPageRevs.set(sessionId, current + 1)
    this.sessionSnapshots.get(sessionId)?.clear()
  }

  storeSnapshot(sessionId: string, entry: SnapshotEntry): void {
    let snapMap = this.sessionSnapshots.get(sessionId)
    if (!snapMap) {
      snapMap = new Map()
      this.sessionSnapshots.set(sessionId, snapMap)
    }
    // LRU eviction: remove oldest if at capacity
    if (snapMap.size >= this.MAX_SNAPSHOTS) {
      const oldest = snapMap.keys().next().value
      if (oldest) snapMap.delete(oldest)
    }
    snapMap.set(entry.snapshot_id, entry)
  }

  getSnapshot(sessionId: string, snapshotId: string): SnapshotEntry | null {
    return this.sessionSnapshots.get(sessionId)?.get(snapshotId) ?? null
  }

  // ---------------------------------------------------------------------------
  // R07-T16/T17: Console log + page error collection
  // ---------------------------------------------------------------------------

  private pushConsole(sessionId: string, entry: ConsoleEntry): void {
    let buf = this.sessionConsoleLog.get(sessionId)
    if (!buf) { buf = []; this.sessionConsoleLog.set(sessionId, buf) }
    buf.push(entry)
    if (buf.length > this.MAX_CONSOLE) buf.shift()
  }

  private pushPageError(sessionId: string, entry: PageErrorEntry): void {
    let buf = this.sessionPageErrors.get(sessionId)
    if (!buf) { buf = []; this.sessionPageErrors.set(sessionId, buf) }
    buf.push(entry)
    if (buf.length > this.MAX_ERRORS) buf.shift()
  }

  getConsoleLog(sessionId: string, tail?: number): ConsoleEntry[] {
    const buf = this.sessionConsoleLog.get(sessionId) ?? []
    return tail ? buf.slice(-tail) : buf.slice()
  }

  getPageErrors(sessionId: string, tail?: number): PageErrorEntry[] {
    const buf = this.sessionPageErrors.get(sessionId) ?? []
    return tail ? buf.slice(-tail) : buf.slice()
  }

  clearConsoleLog(sessionId: string): void {
    this.sessionConsoleLog.set(sessionId, [])
  }

  clearPageErrors(sessionId: string): void {
    this.sessionPageErrors.set(sessionId, [])
  }

  // ---------------------------------------------------------------------------
  // R07-C04-T22: Dialog ring buffer helpers
  // ---------------------------------------------------------------------------

  private pushDialog(sessionId: string, entry: DialogEntry): void {
    let buf = this.sessionDialogs.get(sessionId)
    if (!buf) { buf = []; this.sessionDialogs.set(sessionId, buf) }
    buf.push(entry)
    if (buf.length > this.MAX_DIALOGS) buf.splice(0, buf.length - this.MAX_DIALOGS)
  }

  getDialogs(sessionId: string, tail?: number): DialogEntry[] {
    const buf = this.sessionDialogs.get(sessionId) ?? []
    return tail !== undefined ? buf.slice(-tail) : [...buf]
  }

  clearDialogs(sessionId: string): void {
    this.sessionDialogs.set(sessionId, [])
  }

  // ---------------------------------------------------------------------------
  // R07-C04-T25: Network condition emulation (CDP)
  // ---------------------------------------------------------------------------

  async setNetworkConditions(
    sessionId: string,
    opts: { offline?: boolean; latency_ms?: number; download_kbps?: number; upload_kbps?: number },
  ): Promise<void> {
    const entry = this.contexts.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    // Detach any existing CDP session first
    const existing = this.sessionCdpSessions.get(sessionId)
    if (existing) { await existing.detach().catch(() => {}) }
    const cdp: CDPSession = await entry.context.newCDPSession(entry.page)
    this.sessionCdpSessions.set(sessionId, cdp)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: opts.offline ?? false,
      latency: opts.latency_ms ?? 0,
      downloadThroughput: opts.download_kbps !== undefined ? (opts.download_kbps * 1024) / 8 : -1,
      uploadThroughput: opts.upload_kbps !== undefined ? (opts.upload_kbps * 1024) / 8 : -1,
    })
  }

  async resetNetworkConditions(sessionId: string): Promise<void> {
    const cdp = this.sessionCdpSessions.get(sessionId)
    if (cdp) {
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
      }).catch(() => {})
      await cdp.detach().catch(() => {})
      this.sessionCdpSessions.delete(sessionId)
    }
  }

  /** Register console + pageerror + dialog listeners on a page for observability. */
  private attachPageObservers(sessionId: string, page: Page): void {
    page.on('console', (msg) => {
      this.pushConsole(sessionId, {
        ts: new Date().toISOString(),
        type: msg.type(),
        text: msg.text(),
        url: page.url(),
      })
    })
    page.on('pageerror', (err) => {
      this.pushPageError(sessionId, {
        ts: new Date().toISOString(),
        message: err.message,
        url: page.url(),
      })
    })
    // T22: auto-dismiss dialogs and record them so callers can inspect
    page.on('dialog', async (dialog) => {
      this.pushDialog(sessionId, {
        ts: new Date().toISOString(),
        type: dialog.type(),
        message: dialog.message(),
        default_value: dialog.defaultValue(),
        url: page.url(),
        action: 'dismissed',
      })
      await dialog.dismiss().catch(() => { /* page may have been closed */ })
    })
  }

  private newPageId(): string {
    return 'page_' + crypto.randomBytes(4).toString('hex')
  }

  async launchSession(
    sessionId: string,
    opts: { profile?: string; headless?: boolean; acceptDownloads?: boolean },
  ): Promise<void> {
    const profile = opts.profile ?? 'default'
    const headless = opts.headless ?? true
    const acceptDownloads = opts.acceptDownloads ?? false
    // Persist so switchMode can restore the same setting on relaunch
    this.sessionAcceptDownloads.set(sessionId, acceptDownloads)
    const userDataDir = path.join(profilesDir(this.config), profile)

    const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
      headless,
      acceptDownloads,
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
    this.sessionRoutes.set(sessionId, new Map())
    this.sessionPageRevs.set(sessionId, 0)
    this.sessionSnapshots.set(sessionId, new Map())
    this.sessionConsoleLog.set(sessionId, [])
    this.sessionPageErrors.set(sessionId, [])
    this.sessionDialogs.set(sessionId, [])
    this.registry.attach(sessionId, context, page)

    // R07-T13: increment page_rev on main-frame navigation (clears snapshots)
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.incrementPageRev(sessionId)
      }
    })
    // R07-T16/T17: collect console log + page errors
    this.attachPageObservers(sessionId, page)
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
    // R07-T13 fix: track navigations on new pages so page_rev increments correctly
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.incrementPageRev(sessionId)
      }
    })
    // R07-T16/T17: collect console log + page errors on new pages too
    this.attachPageObservers(sessionId, page)
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
    // r05-c05 P2: prevent closing the last remaining page
    if (state.pages.size <= 1) {
      const err = new Error('Cannot close the last remaining page in a session') as Error & { code: string }
      err.code = 'LAST_PAGE'
      throw err
    }
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
  // CDP WebSocket URL (T06)
  // ---------------------------------------------------------------------------

  getCdpWsUrl(sessionId: string): string | null {
    const entry = this.contexts.get(sessionId)
    if (!entry) return null
    // playwright-core Browser exposes wsEndpoint() at runtime but not in types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (entry.context.browser() as any)?.wsEndpoint?.() ?? null
  }

  // ---------------------------------------------------------------------------
  // Network route mock management (T07)
  // ---------------------------------------------------------------------------

  async addRoute(sessionId: string, pattern: string, mock: RouteMockConfig): Promise<void> {
    const entry = this.contexts.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    // Remove existing handler for this pattern if any
    await this.removeRoute(sessionId, pattern)
    const routeState = this.sessionRoutes.get(sessionId) ?? new Map<string, RouteEntry>()
    this.sessionRoutes.set(sessionId, routeState)
    const handler = async (route: Route): Promise<void> => {
      await route.fulfill({
        status: mock.status ?? 200,
        contentType: mock.content_type,
        headers: mock.headers,
        body: mock.body,
      })
    }
    await entry.context.route(pattern, handler)
    routeState.set(pattern, { pattern, mock, handler })
  }

  async removeRoute(sessionId: string, pattern: string): Promise<void> {
    const entry = this.contexts.get(sessionId)
    const routeState = this.sessionRoutes.get(sessionId)
    if (!entry || !routeState) return
    const existing = routeState.get(pattern)
    if (existing) {
      try { await entry.context.unroute(pattern, existing.handler) } catch { /* ignore */ }
      routeState.delete(pattern)
    }
  }

  listRoutes(sessionId: string): Array<{ pattern: string; mock: RouteMockConfig }> {
    const routeState = this.sessionRoutes.get(sessionId)
    if (!routeState) return []
    return Array.from(routeState.values()).map(({ pattern, mock }) => ({ pattern, mock }))
  }

  private async cleanupRoutes(sessionId: string): Promise<void> {
    const entry = this.contexts.get(sessionId)
    const routeState = this.sessionRoutes.get(sessionId)
    if (!entry || !routeState) return
    for (const [pattern, routeEntry] of routeState.entries()) {
      try { await entry.context.unroute(pattern, routeEntry.handler) } catch { /* context may be closing */ }
    }
    routeState.clear()
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

    // Preserve acceptDownloads setting across mode switch
    const acceptDownloads = this.sessionAcceptDownloads.get(sessionId) ?? false
    await this.cleanupRoutes(sessionId)
    this.sessionRoutes.delete(sessionId)
    this.sessionPageRevs.delete(sessionId)
    this.sessionSnapshots.delete(sessionId)
    this.sessionConsoleLog.delete(sessionId)
    this.sessionPageErrors.delete(sessionId)
    this.sessionDialogs.delete(sessionId)
    await this.resetNetworkConditions(sessionId).catch(() => {})
    await existing.context.close()
    this.contexts.delete(sessionId)
    this.sessionPages.delete(sessionId)

    await this.launchSession(sessionId, { profile: s.profile, headless: !headed, acceptDownloads })
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

  getAcceptDownloads(sessionId: string): boolean {
    return this.sessionAcceptDownloads.get(sessionId) ?? false
  }

  async closeSession(sessionId: string): Promise<void> {
    const entry = this.contexts.get(sessionId)
    if (entry) {
      await this.cleanupRoutes(sessionId)
      this.sessionRoutes.delete(sessionId)
      this.sessionAcceptDownloads.delete(sessionId)
      this.sessionPageRevs.delete(sessionId)
      this.sessionSnapshots.delete(sessionId)
      this.sessionConsoleLog.delete(sessionId)
      this.sessionPageErrors.delete(sessionId)
      this.sessionDialogs.delete(sessionId)
      await this.resetNetworkConditions(sessionId).catch(() => {})
      await entry.context.close()
      this.contexts.delete(sessionId)
      this.sessionPages.delete(sessionId)
    }
  }

  // ---------------------------------------------------------------------------
  // R07-T05: Cookie and storage state management
  // ---------------------------------------------------------------------------

  async getCookies(sessionId: string, urls?: string[]): Promise<object[]> {
    const entry = this.contexts.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    return entry.context.cookies(urls)
  }

  async addCookies(sessionId: string, cookies: object[]): Promise<void> {
    const entry = this.contexts.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await entry.context.addCookies(cookies as any)
  }

  async clearCookies(sessionId: string): Promise<void> {
    const entry = this.contexts.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    await entry.context.clearCookies()
  }

  async getStorageState(sessionId: string): Promise<object> {
    const entry = this.contexts.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    return entry.context.storageState()
  }

  async addInitScript(sessionId: string, script: string): Promise<void> {
    const entry = this.contexts.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    await entry.context.addInitScript(script)
  }
}
