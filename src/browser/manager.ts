import path from 'path'
import { chromium, BrowserContext, Page } from 'playwright-core'
import { SessionRegistry } from '../daemon/session'
import { DaemonConfig, profilesDir } from '../daemon/config'

export class BrowserManager {
  private contexts = new Map<string, { context: BrowserContext; page: Page }>()

  constructor(
    private registry: SessionRegistry,
    private config: DaemonConfig,
  ) {}

  async launchSession(
    sessionId: string,
    opts: { profile?: string; headless?: boolean },
  ): Promise<void> {
    const profile = opts.profile ?? 'default'
    const headless = opts.headless ?? true
    const userDataDir = path.join(profilesDir(this.config), profile)

    const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
      headless,
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
    this.contexts.set(sessionId, { context, page })
    this.registry.attach(sessionId, context, page)
  }

  async switchMode(sessionId: string, headed: boolean): Promise<void> {
    // Switching headless↔headed requires relaunching the browser.
    // We close the current context and relaunch with the same profile.
    const existing = this.contexts.get(sessionId)
    if (!existing) throw new Error(`Session ${sessionId} not found`)

    const s = this.registry.get(sessionId)!
    await existing.context.close()
    this.contexts.delete(sessionId)

    await this.launchSession(sessionId, { profile: s.profile, headless: !headed })
    // Persist updated headless flag (launchSession/attach spreads old value)
    this.registry.updateHeadless(sessionId, !headed)
  }

  async closeSession(sessionId: string): Promise<void> {
    const entry = this.contexts.get(sessionId)
    if (entry) {
      await entry.context.close()
      this.contexts.delete(sessionId)
    }
  }
}
