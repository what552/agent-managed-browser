import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { chromium, Browser, BrowserContext, Page, Route, CDPSession } from 'playwright-core'
import { SessionRegistry } from '../daemon/session'
import { DaemonConfig, profilesDir, chromeProfilesDir } from '../daemon/config'

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
  delay_ms?: number
}

interface RouteEntry {
  pattern: string
  playwrightPattern: string | RegExp
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
  /** R08-modes: Browser references for CDP-attach sessions (disconnect instead of close) */
  private sessionCdpBrowsers = new Map<string, Browser>()
  /** R08-modes: Ephemeral temp dir paths (cleaned up on session close) */
  private sessionEphemeralDirs = new Map<string, string>()
  /** R09-C04-T08: Video recording dir per session */
  private sessionVideoDir = new Map<string, string>()
  /** R09-C04-T14: Allowed local dirs per session (allowDirs whitelist) */
  private sessionAllowDirs = new Map<string, string[]>()

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

  /**
   * R09-C06-P1: Auto-track pages opened externally (window.open, CDP PUT /json/new, etc.)
   * by listening to the BrowserContext 'page' event.
   */
  private autoTrackNewPages(sessionId: string, context: BrowserContext): void {
    context.on('page', (newPage: Page) => {
      const state = this.sessionPages.get(sessionId)
      if (!state) return
      // Skip if already tracked (e.g. initial page added in launchSession/attachCdpSession)
      const alreadyTracked = Array.from(state.pages.values()).some(p => p === newPage)
      if (alreadyTracked) return
      const newPageId = this.newPageId()
      state.pages.set(newPageId, newPage)
      newPage.on('framenavigated', (frame) => {
        if (frame === newPage.mainFrame()) this.incrementPageRev(sessionId)
      })
      this.attachPageObservers(sessionId, newPage)
    })
  }

  async launchSession(
    sessionId: string,
    opts: {
      profile?: string
      headless?: boolean
      acceptDownloads?: boolean
      channel?: string
      executablePath?: string
      ephemeral?: boolean
      proxyUrl?: string
      recordVideo?: boolean
      allowDirs?: string[]
    },
  ): Promise<void> {
    const profile = opts.profile ?? 'default'
    const headless = opts.headless ?? true
    const acceptDownloads = opts.acceptDownloads ?? false
    // Persist so switchMode can restore the same setting on relaunch
    this.sessionAcceptDownloads.set(sessionId, acceptDownloads)

    // T14: store allowed local dirs.
    // R09-C07-P0: resolve via realpath (follows symlinks on disk) so that the stored
    // paths match the realpath-resolved paths we compare against in handleLs / file:// guard.
    // Falls back to path.resolve() if the directory does not yet exist.
    if (opts.allowDirs && opts.allowDirs.length > 0) {
      const resolved = await Promise.all(
        opts.allowDirs.map(async d => {
          try { return await fs.promises.realpath(d) } catch { return path.resolve(d) }
        }),
      )
      this.sessionAllowDirs.set(sessionId, resolved)
    }

    let userDataDir: string
    if (opts.ephemeral) {
      // Pure Sandbox: ephemeral temp dir — cleaned up on close
      userDataDir = path.join(os.tmpdir(), `agentmb-eph-${sessionId}`)
      this.sessionEphemeralDirs.set(sessionId, userDataDir)
    } else {
      // T01: chrome/msedge use chrome-profiles/; Playwright-managed use profiles/
      const baseDir = (opts.channel === 'chrome' || opts.channel === 'msedge')
        ? chromeProfilesDir(this.config)
        : profilesDir(this.config)
      userDataDir = path.join(baseDir, profile)
    }
    fs.mkdirSync(userDataDir, { recursive: true })

    const launchOpts: Parameters<typeof chromium.launchPersistentContext>[1] = {
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
    }
    // Multi-channel: system Chrome / Edge (mutually exclusive with executablePath)
    if (opts.channel) (launchOpts as any).channel = opts.channel
    if (opts.executablePath) (launchOpts as any).executablePath = opts.executablePath
    // T08: session-level proxy
    if (opts.proxyUrl) (launchOpts as any).proxy = { server: opts.proxyUrl }
    // T08: video recording
    if (opts.recordVideo) {
      const videoDir = path.join(os.tmpdir(), `agentmb-video-${sessionId}`)
      await fs.promises.mkdir(videoDir, { recursive: true })
      ;(launchOpts as any).recordVideo = { dir: videoDir, size: { width: 1280, height: 720 } }
      this.sessionVideoDir.set(sessionId, videoDir)
    }

    const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, launchOpts)

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
    // R09-C06-P1: track pages opened externally (window.open, etc.)
    this.autoTrackNewPages(sessionId, context)
  }

  // ---------------------------------------------------------------------------
  // R08-modes: CDP Attach (connectOverCDP)
  // ---------------------------------------------------------------------------

  async attachCdpSession(
    sessionId: string,
    cdpUrl: string,
    target?: { url_contains?: string; title_contains?: string; index?: number },
  ): Promise<void> {
    const browser: Browser = await chromium.connectOverCDP(cdpUrl)
    this.sessionCdpBrowsers.set(sessionId, browser)

    const downloadsPath = path.join(os.homedir(), 'Downloads')
    // B01: pass downloadsPath when we need to create a new context
    const existingContexts = browser.contexts()
    const ctx: BrowserContext = existingContexts.length > 0
      ? existingContexts[0]
      : await browser.newContext({ downloadsPath } as any)

    // B04: enumerate ALL existing pages and register them in pagesMap
    const existingPages = ctx.pages()
    const pagesMap = new Map<string, Page>()
    for (const p of existingPages) {
      pagesMap.set(this.newPageId(), p)
    }

    // B01: for reused existing contexts, redirect downloads via CDP (best-effort)
    if (existingContexts.length > 0 && existingPages.length > 0) {
      try {
        const cdpSess = await ctx.newCDPSession(existingPages[0])
        await cdpSess.send('Browser.setDownloadBehavior', {
          behavior: 'allowAndName',
          downloadPath: downloadsPath,
        })
        await cdpSess.detach()
      } catch { /* ignore — some browsers/versions don't support this */ }
    }

    // Determine active page using target matching logic
    let page: Page | null = null
    let activePageId: string | null = null

    if (target && existingPages.length > 0) {
      let matchedPage: Page | null = null
      if (target.url_contains) {
        matchedPage = existingPages.find((p) => p.url().includes(target.url_contains!)) ?? null
      } else if (target.title_contains) {
        for (const p of existingPages) {
          try {
            const t = await p.title()
            if (t.includes(target.title_contains)) { matchedPage = p; break }
          } catch { /* ignore */ }
        }
      } else if (target.index !== undefined) {
        matchedPage = existingPages[target.index] ?? null
      }
      if (matchedPage) {
        page = matchedPage
        activePageId = Array.from(pagesMap.entries()).find(([, p]) => p === matchedPage)?.[0] ?? null
      }
    }

    // Fall back to first page, or create one if none exist
    if (!page) {
      if (existingPages.length > 0) {
        page = existingPages[0]
        activePageId = Array.from(pagesMap.keys())[0]!
      } else {
        page = await ctx.newPage()
        const pid = this.newPageId()
        pagesMap.set(pid, page)
        activePageId = pid
      }
    }
    // Safety: ensure activePageId resolves
    if (!activePageId) {
      activePageId = Array.from(pagesMap.entries()).find(([, p]) => p === page)?.[0]
        ?? Array.from(pagesMap.keys())[0]!
    }

    this.contexts.set(sessionId, { context: ctx, page })
    this.sessionPages.set(sessionId, { pages: pagesMap, activePageId })
    this.sessionRoutes.set(sessionId, new Map())
    this.sessionPageRevs.set(sessionId, 0)
    this.sessionSnapshots.set(sessionId, new Map())
    this.sessionConsoleLog.set(sessionId, [])
    this.sessionPageErrors.set(sessionId, [])
    this.sessionDialogs.set(sessionId, [])
    this.registry.attach(sessionId, ctx, page)

    // B04: attach nav + observability to ALL registered pages (not just active one)
    for (const [, p] of pagesMap) {
      p.on('framenavigated', (frame) => {
        if (frame === p.mainFrame()) this.incrementPageRev(sessionId)
      })
      this.attachPageObservers(sessionId, p)
    }
    // R09-C06-P1: track pages opened via CDP (PUT /json/new, window.open, etc.)
    this.autoTrackNewPages(sessionId, ctx)
  }

  // ---------------------------------------------------------------------------
  // Multi-page management (T03)
  // ---------------------------------------------------------------------------

  async createPage(sessionId: string): Promise<{ page_id: string; url: string }> {
    const entry = this.contexts.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    const page = await entry.context.newPage()
    const state = this.sessionPages.get(sessionId)!
    // R09-C06-P1b: autoTrackNewPages fires via context 'page' event before this
    // resumes, so the page may already be registered — return that entry if so.
    const existing = Array.from(state.pages.entries()).find(([, p]) => p === page)
    if (existing) {
      return { page_id: existing[0], url: page.url() }
    }
    const pageId = this.newPageId()
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
    // R09-C07-P1: explicitly remove all listeners before close so closures are
    // released immediately rather than waiting for GC after page.close().
    page.removeAllListeners()
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

  getPageById(sessionId: string, pageId: string): Page | null {
    const state = this.sessionPages.get(sessionId)
    if (!state) return null
    return state.pages.get(pageId) ?? null
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

  /** Parse a pattern string: if it looks like /regex/flags, return a RegExp; else the string itself. */
  private parseRoutePattern(pattern: string): string | RegExp {
    const m = pattern.match(/^\/(.+)\/([gimsuy]*)$/)
    if (m) {
      try { return new RegExp(m[1], m[2]) } catch { /* fall through to string */ }
    }
    return pattern
  }

  async addRoute(sessionId: string, pattern: string, mock: RouteMockConfig): Promise<void> {
    const entry = this.contexts.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    // Remove existing handler for this pattern if any
    await this.removeRoute(sessionId, pattern)
    const routeState = this.sessionRoutes.get(sessionId) ?? new Map<string, RouteEntry>()
    this.sessionRoutes.set(sessionId, routeState)
    const playwrightPattern = this.parseRoutePattern(pattern)
    const handler = async (route: Route): Promise<void> => {
      // R09-C07-P0: cap delay_ms at 60 s to prevent unbounded timers (e.g. 999999ms)
      // while still allowing values that exceed Playwright's 30 s default timeout.
      // Using 60 s keeps a clear gap above the default timeout so there is no race
      // between the route delay and the navigation timeout.
      if (mock.delay_ms && mock.delay_ms > 0) {
        await new Promise<void>(r => setTimeout(r, Math.min(mock.delay_ms!, 60_000)))
      }
      try {
        await route.fulfill({
          status: mock.status ?? 200,
          contentType: mock.content_type,
          headers: mock.headers,
          body: mock.body,
        })
      } catch {
        // Request context destroyed (e.g. page closed / navigation timed out) — ignore.
      }
    }
    await entry.context.route(playwrightPattern, handler)
    routeState.set(pattern, { pattern, playwrightPattern, mock, handler })
  }

  async removeRoute(sessionId: string, pattern: string): Promise<void> {
    const entry = this.contexts.get(sessionId)
    const routeState = this.sessionRoutes.get(sessionId)
    if (!entry || !routeState) return
    const existing = routeState.get(pattern)
    if (existing) {
      try { await entry.context.unroute(existing.playwrightPattern, existing.handler) } catch { /* ignore */ }
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
    for (const [, routeEntry] of routeState.entries()) {
      try { await entry.context.unroute(routeEntry.playwrightPattern, routeEntry.handler) } catch { /* context may be closing */ }
    }
    routeState.clear()
  }

  // ---------------------------------------------------------------------------
  // Mode switch (headless ↔ headed)
  // ---------------------------------------------------------------------------

  async switchMode(sessionId: string, headed: boolean): Promise<void> {
    const existing = this.contexts.get(sessionId)
    if (!existing) throw new Error(`Session ${sessionId} not found`)

    // CDP attach sessions cannot switch mode — the remote browser controls headless/headed
    if (this.sessionCdpBrowsers.has(sessionId)) {
      const err = new Error('mode_switch_unavailable: CDP attach sessions cannot switch headless/headed mode') as Error & { code: string }
      err.code = 'MODE_SWITCH_UNAVAILABLE'
      throw err
    }

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

  /** R09-C04-T14: Get allowed local dirs for a session. */
  getAllowDirs(sessionId: string): string[] {
    return this.sessionAllowDirs.get(sessionId) ?? []
  }

  /** R09-C04-T08: Get video file path for session (null if not recording or not saved yet). */
  async getVideoPath(sessionId: string): Promise<string | null> {
    const entry = this.contexts.get(sessionId)
    if (!entry) return null
    const video = entry.page.video()
    if (!video) return null
    try { return await video.path() } catch { return null }
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
      this.sessionAllowDirs.delete(sessionId)
      this.sessionVideoDir.delete(sessionId)
      await this.resetNetworkConditions(sessionId).catch(() => {})

      // CDP attach: close browser handle (disconnects without killing remote process);
      // managed: close context (kills the browser subprocess)
      const cdpBrowser = this.sessionCdpBrowsers.get(sessionId)
      if (cdpBrowser) {
        await cdpBrowser.close().catch(() => {})
        this.sessionCdpBrowsers.delete(sessionId)
      } else {
        await entry.context.close()
      }
      this.contexts.delete(sessionId)
      this.sessionPages.delete(sessionId)
    }

    // Clean up ephemeral temp dir (regardless of whether context was live)
    const ephDir = this.sessionEphemeralDirs.get(sessionId)
    if (ephDir) {
      try { fs.rmSync(ephDir, { recursive: true, force: true }) } catch { /* ignore */ }
      this.sessionEphemeralDirs.delete(sessionId)
    }
  }

  /** Called on daemon shutdown: disconnect CDP sessions, clean ephemeral dirs, then close all managed contexts. */
  async shutdownAll(): Promise<void> {
    // First close CDP-attached browser handles (disconnects without killing remote processes)
    for (const [id, browser] of this.sessionCdpBrowsers) {
      await browser.close().catch(() => {})
      this.sessionCdpBrowsers.delete(id)
    }
    // Clean up ephemeral temp dirs
    for (const [id, dir] of this.sessionEphemeralDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
      this.sessionEphemeralDirs.delete(id)
    }
    // Let registry handle persisting zombie state + closing remaining managed contexts
    await this.registry.shutdownAll()
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
