import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { FastifyInstance } from 'fastify'
import { SessionRegistry } from '../session'
import { BrowserManager, PageInfo, RouteMockConfig } from '../../browser/manager'
import { AuditLogger } from '../../audit/logger'
import '../types' // T11: Fastify type augmentation
import type { PolicyProfileName } from '../../policy/types'

// ---------------------------------------------------------------------------
// T12: CDP error sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize CDP error messages before returning them to callers.
 * Removes internal file paths, stack frames, and truncates to 300 chars.
 */
function sanitizeCdpError(raw: string): string {
  return raw
    .replace(/\s*at\s+\S+\s*\([^)]*\)/g, '') // remove stack frames
    .replace(/file:\/\/\/[^\s,)]+/g, '[internal]') // replace internal paths
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 300)
}

function isRetryableProfileDeleteError(err: unknown): boolean {
  const code = String((err as any)?.code ?? '')
  const message = String((err as any)?.message ?? '')
  if (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') return true
  return /resource busy|locked|not empty/i.test(message)
}

async function removeProfileDirWithRetry(profilePath: string, attempts = 6): Promise<void> {
  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fs.promises.rm(profilePath, { recursive: true, force: true })
      return
    } catch (err) {
      lastError = err
      if (!isRetryableProfileDeleteError(err) || i === attempts - 1) break
      // Give the browser process a brief window to release filesystem handles.
      await new Promise((resolve) => setTimeout(resolve, 120 * (i + 1)))
    }
  }
  throw lastError
}

export function registerSessionRoutes(server: FastifyInstance, registry: SessionRegistry): void {
  // POST /api/v1/sessions — create session
  server.post<{
    Body: {
      profile?: string
      headless?: boolean
      agent_id?: string
      accept_downloads?: boolean
      ephemeral?: boolean
      browser_channel?: string
      executable_path?: string
      launch_mode?: 'managed' | 'attach'
      cdp_url?: string
      proxy_url?: string
      record_video?: boolean
      allow_dirs?: string[]
      allow_extensions?: boolean
    }
  }>('/api/v1/sessions', async (req, reply) => {
    const {
      profile, headless = true, agent_id, accept_downloads = false,
      ephemeral, browser_channel, executable_path,
      launch_mode, cdp_url, proxy_url, record_video, allow_dirs,
      allow_extensions,
    } = req.body ?? {}

    const manager = server.browserManager
    if (!manager) {
      return reply.code(503).send({ error: 'Browser manager not initialized' })
    }

    // Preflight validation
    const VALID_CHANNELS = ['chromium', 'chrome', 'msedge']
    if (browser_channel && executable_path) {
      return reply.code(400).send({ error: 'preflight_failed', field: 'browser_channel', reason: 'browser_channel and executable_path are mutually exclusive' })
    }
    if (browser_channel && !VALID_CHANNELS.includes(browser_channel)) {
      return reply.code(400).send({ error: 'preflight_failed', field: 'browser_channel', reason: `Invalid browser_channel; valid values: ${VALID_CHANNELS.join(', ')}` })
    }
    if (launch_mode === 'attach') {
      if (!cdp_url) {
        return reply.code(400).send({ error: 'preflight_failed', field: 'cdp_url', reason: 'cdp_url is required when launch_mode=attach' })
      }
      if (!cdp_url.startsWith('http://') && !cdp_url.startsWith('https://') && !cdp_url.startsWith('ws://') && !cdp_url.startsWith('wss://')) {
        return reply.code(400).send({ error: 'preflight_failed', field: 'cdp_url', reason: 'cdp_url must be a valid http/https/ws/wss URL' })
      }
      if (browser_channel || executable_path) {
        return reply.code(400).send({ error: 'preflight_failed', field: 'browser_channel', reason: 'browser_channel/executable_path cannot be used with launch_mode=attach' })
      }
    }

    const id = registry.create({
      profile, headless, agentId: agent_id,
      ephemeral, browserChannel: browser_channel, executablePath: executable_path,
      launchMode: launch_mode, cdpUrl: cdp_url, allowExtensions: allow_extensions,
    })

    try {
      if (launch_mode === 'attach') {
        await manager.attachCdpSession(id, cdp_url!)
        getLogger()?.write({
          session_id: id,
          action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
          type: 'session',
          action: 'attach',
          params: { cdp_url },
          result: { status: 'ok' },
        })
        const s = registry.get(id)!
        return reply.code(201).send({
          session_id: s.id,
          profile: s.profile,
          headless: s.headless,
          created_at: s.createdAt,
          launch_mode: 'attach',
          cdp_url,
          warning: 'close will disconnect only; remote browser process is not terminated',
        })
      } else {
        await manager.launchSession(id, {
          profile, headless, acceptDownloads: accept_downloads,
          channel: browser_channel, executablePath: executable_path, ephemeral,
          proxyUrl: proxy_url, recordVideo: record_video, allowDirs: allow_dirs,
          allowExtensions: allow_extensions,
        })
      }
    } catch (err: any) {
      // Use registry.close() so persist() is called and sessions.json stays clean
      await registry.close(id)
      return reply.code(500).send({ error: err.message })
    }

    const s = registry.get(id)!
    return reply.code(201).send({
      session_id: s.id,
      profile: s.profile,
      headless: s.headless,
      created_at: s.createdAt,
      accept_downloads: manager.getAcceptDownloads(id),
      ephemeral: s.ephemeral ?? false,
      browser_channel: s.browserChannel ?? null,
      launch_mode: s.launchMode ?? 'managed',
      allow_extensions: s.allowExtensions ?? false,
    })
  })

  // GET /api/v1/sessions — list (normalized to snake_case for SDK)
  server.get('/api/v1/sessions', async () => {
    return registry.list().map((s) => {
      // R10-C07: infer zone from browserChannel (Issue #15)
      const zone = (s.browserChannel === 'chrome' || s.browserChannel === 'msedge') ? 'stable' : 'managed'
      return {
        session_id: s.id,
        profile: s.profile,
        headless: s.headless,
        created_at: s.createdAt,
        state: s.state,
        zone,
        agent_id: s.agentId ?? null,
        ephemeral: s.ephemeral ?? false,
        browser_channel: s.browserChannel ?? null,
        launch_mode: s.launchMode ?? 'managed',
        cdp_url: s.cdpUrl ?? null,
        sealed: s.sealed ?? false,
      }
    })
  })

  // DELETE /api/v1/sessions?state=zombie — bulk prune zombie sessions (Issue #14)
  server.delete<{ Querystring: { state?: string; dry_run?: string; older_than_days?: string } }>(
    '/api/v1/sessions',
    async (req, reply) => {
      if (req.query.state !== 'zombie') {
        return reply.code(400).send({ error: "state query param must be 'zombie'" })
      }
      const dryRun = req.query.dry_run === 'true'
      const olderThanDays = req.query.older_than_days ? parseInt(req.query.older_than_days, 10) : undefined
      const candidates = registry.list().filter((s) => {
        if (s.state !== 'zombie') return false
        if (olderThanDays !== undefined) {
          const ageMs = Date.now() - new Date(s.createdAt).getTime()
          return ageMs > olderThanDays * 24 * 60 * 60 * 1000
        }
        return true
      })
      if (!dryRun) {
        for (const s of candidates) {
          await registry.close(s.id)
        }
      }
      return { pruned: candidates.length, ids: candidates.map((s) => s.id), dry_run: dryRun }
    },
  )

  // GET /api/v1/sessions/:id
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    return {
      session_id: s.id,
      profile: s.profile,
      headless: s.headless,
      created_at: s.createdAt,
      state: s.state,
      agent_id: s.agentId ?? null,
      ephemeral: s.ephemeral ?? false,
      browser_channel: s.browserChannel ?? null,
      launch_mode: s.launchMode ?? 'managed',
      cdp_url: s.cdpUrl ?? null,
      sealed: s.sealed ?? false,
    }
  })

  // DELETE /api/v1/sessions/:id
  server.delete<{ Params: { id: string }; Querystring: { force?: string } }>('/api/v1/sessions/:id', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const force = req.query.force === 'true'
    if (s.sealed && !force) {
      return reply.code(423).send({ error: 'session_sealed', message: 'Session is sealed and cannot be deleted. Use ?force=true or POST /unseal first.' })
    }
    // Clean up BrowserManager internal state first, then registry
    const manager = server.browserManager
    if (manager) await manager.closeSession(req.params.id)
    await registry.close(req.params.id)
    return reply.code(204).send()
  })

  // POST /api/v1/sessions/:id/attach — re-attach zombie or live session to a running browser via CDP
  server.post<{
    Params: { id: string }
    Body: { cdp_url: string; url_contains?: string; title_contains?: string; index?: number }
  }>('/api/v1/sessions/:id/attach', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })

    const { cdp_url, url_contains, title_contains, index } = req.body ?? {}
    if (!cdp_url) return reply.code(400).send({ error: 'cdp_url is required' })
    if (!cdp_url.startsWith('http://') && !cdp_url.startsWith('https://') && !cdp_url.startsWith('ws://') && !cdp_url.startsWith('wss://')) {
      return reply.code(400).send({ error: 'cdp_url must be a valid http/https/ws/wss URL' })
    }

    const target = (url_contains || title_contains || index !== undefined)
      ? { url_contains, title_contains, index }
      : undefined

    try {
      await manager.attachCdpSession(req.params.id, cdp_url, target)
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
    getLogger()?.write({
      session_id: req.params.id,
      action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
      type: 'session',
      action: 'attach',
      params: { cdp_url },
      result: { status: 'ok' },
    })
    return {
      session_id: req.params.id,
      launch_mode: 'attach',
      cdp_url,
      warning: 'close will disconnect only; remote browser process is not terminated',
    }
  })

  // ---------------------------------------------------------------------------
  // R10-T03: session adopt — extract CDP browser state → new managed session
  // NOTE: register /sessions/adopt BEFORE /sessions/:id/* so Fastify matches static first
  // ---------------------------------------------------------------------------

  server.post<{
    Body: { cdp_url: string; profile: string; headed?: boolean }
  }>('/api/v1/sessions/adopt', async (req, reply) => {
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })

    const { cdp_url, profile: targetProfile, headed } = req.body ?? {}
    if (!cdp_url) return reply.code(400).send({ error: 'cdp_url is required' })
    if (!cdp_url.startsWith('http://') && !cdp_url.startsWith('https://') && !cdp_url.startsWith('ws://') && !cdp_url.startsWith('wss://')) {
      return reply.code(400).send({ error: 'cdp_url must be http/https/ws/wss' })
    }
    if (!targetProfile) return reply.code(400).send({ error: 'profile is required' })

    const headless = !headed

    // Step 1: NON-INVASIVELY extract state from external browser via CDP
    const { chromium: chromiumPw } = await import('playwright-core')
    let storageState: { cookies: any[]; origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> }
    let cdpBrowser: any
    try {
      cdpBrowser = await chromiumPw.connectOverCDP(cdp_url)
      const contexts = cdpBrowser.contexts()
      if (contexts.length === 0) {
        await cdpBrowser.close()
        return reply.code(422).send({ error: 'No browser context found at the CDP URL. Make sure the browser is open with --remote-debugging-port.' })
      }
      storageState = await contexts[0].storageState()
    } catch (err: any) {
      try { await cdpBrowser?.close() } catch { /* ignore */ }
      return reply.code(502).send({ error: `Failed to connect/extract from CDP: ${err.message}` })
    } finally {
      // Disconnect WITHOUT closing remote browser
      try { await cdpBrowser?.close() } catch { /* ignore */ }
    }

    // Step 2: Create and launch new managed Chromium session
    const newId = registry.create({ profile: targetProfile, headless, launchMode: 'managed' })
    try {
      await manager.launchSession(newId, { profile: targetProfile, headless })
    } catch (err: any) {
      await registry.close(newId)
      return reply.code(500).send({ error: `Failed to launch session: ${err.message}` })
    }

    // Step 3: Inject cookies (immediate)
    const cookies = storageState.cookies ?? []
    let cookieWarning: string | undefined
    try {
      if (cookies.length > 0) await manager.addCookies(newId, cookies)
    } catch (err: any) {
      cookieWarning = `Cookie injection failed: ${err.message}`
    }

    // Step 4: Inject localStorage via initScript (deferred until page load at each origin)
    const origins = (storageState.origins ?? []).filter(o => o.localStorage?.length > 0)
    if (origins.length > 0) {
      const chunks = origins.map(o => {
        const kv = o.localStorage.map(item =>
          `localStorage.setItem(${JSON.stringify(item.name)},${JSON.stringify(item.value)})`
        ).join(';')
        return `if(location.origin===${JSON.stringify(o.origin)}){${kv}}`
      })
      try { await manager.addInitScript(newId, chunks.join(';')) } catch { /* non-fatal */ }
    }

    getLogger()?.write({
      session_id: newId,
      action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
      type: 'session',
      action: 'adopt',
      params: { source_cdp_url: cdp_url, profile: targetProfile },
      result: { cookies_injected: cookies.length, origins_pending: origins.length },
    })

    return reply.code(201).send({
      session_id: newId,
      profile: targetProfile,
      channel: 'chromium',
      source_cdp_url: cdp_url,
      cookies_injected: cookies.length,
      origins_pending: origins.length,
      note: 'Source browser untouched — state extracted read-only. New managed session ready.',
      ...(cookieWarning ? { warning: cookieWarning } : {}),
    })
  })

  // ---------------------------------------------------------------------------
  // R10-T03: session fork — clone state from live session into new session
  // ---------------------------------------------------------------------------

  server.post<{
    Params: { id: string }
    Body: { channel?: string; profile?: string; headed?: boolean }
  }>('/api/v1/sessions/:id/fork', async (req, reply) => {
    const live = registry.getLive(req.params.id)
    if ('notFound' in live) return reply.code(404).send({ error: `Session not found: ${req.params.id}` })
    if ('zombie' in live) return reply.code(410).send({ error: 'Session browser is not running', state: 'zombie' })

    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })

    const { channel, profile: targetProfile, headed } = req.body ?? {}
    const headless = !headed

    const VALID_CHANNELS = ['chromium', 'chrome', 'msedge']
    if (channel && !VALID_CHANNELS.includes(channel)) {
      return reply.code(400).send({ error: `Invalid channel '${channel}'. Valid: ${VALID_CHANNELS.join(', ')}` })
    }

    // Step 1: Export state from source session
    let storageState: { cookies: any[]; origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> }
    try {
      storageState = await manager.getStorageState(req.params.id) as any
    } catch (err: any) {
      return reply.code(500).send({ error: `Failed to export storage state: ${err.message}` })
    }

    // Step 2: Create and launch forked session
    const resolvedProfile = targetProfile ?? live.profile
    // 'chromium' is default channel → pass undefined so launchSession uses default
    const resolvedChannel = (channel && channel !== 'chromium') ? channel : undefined

    const newId = registry.create({
      profile: resolvedProfile,
      headless,
      browserChannel: resolvedChannel,
      launchMode: 'managed',
    })

    try {
      await manager.launchSession(newId, {
        profile: resolvedProfile,
        headless,
        channel: resolvedChannel,
      })
    } catch (err: any) {
      await registry.close(newId)
      return reply.code(500).send({ error: `Failed to launch fork session: ${err.message}` })
    }

    // Step 3: Inject cookies (immediate)
    const cookies = storageState.cookies ?? []
    let cookieWarning: string | undefined
    try {
      if (cookies.length > 0) await manager.addCookies(newId, cookies)
    } catch (err: any) {
      cookieWarning = `Cookie injection failed: ${err.message}`
    }

    // Step 4: Inject localStorage via initScript (runs on each subsequent page load at each origin)
    const origins = (storageState.origins ?? []).filter(o => o.localStorage?.length > 0)
    if (origins.length > 0) {
      const chunks = origins.map(o => {
        const kv = o.localStorage.map(item =>
          `localStorage.setItem(${JSON.stringify(item.name)},${JSON.stringify(item.value)})`
        ).join(';')
        return `if(location.origin===${JSON.stringify(o.origin)}){${kv}}`
      })
      try { await manager.addInitScript(newId, chunks.join(';')) } catch { /* non-fatal */ }
    }

    getLogger()?.write({
      session_id: newId,
      action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
      type: 'session',
      action: 'fork',
      params: { source_session_id: req.params.id, channel: channel ?? 'chromium', profile: resolvedProfile },
      result: { cookies_injected: cookies.length, origins_pending: origins.length },
    })

    return reply.code(201).send({
      session_id: newId,
      profile: resolvedProfile,
      channel: channel ?? 'chromium',
      source_session_id: req.params.id,
      cookies_injected: cookies.length,
      origins_pending: origins.length,
      ...(cookieWarning ? { warning: cookieWarning } : {}),
    })
  })

  // ---------------------------------------------------------------------------
  // R10-T04: switch-engine — hot-swap Chromium ↔ Chrome/Edge with state transfer
  // ---------------------------------------------------------------------------

  server.put<{
    Params: { id: string }
    Body: { target_channel: string; keep_source?: boolean; headed?: boolean }
  }>('/api/v1/sessions/:id/switch-engine', async (req, reply) => {
    const live = registry.getLive(req.params.id)
    if ('notFound' in live) return reply.code(404).send({ error: `Session not found: ${req.params.id}` })
    if ('zombie' in live) return reply.code(410).send({ error: 'Session browser is not running', state: 'zombie' })

    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })

    const { target_channel, keep_source = false, headed = false } = req.body ?? {}
    const headless = !headed

    const VALID_CHANNELS = ['chromium', 'chrome', 'msedge']
    if (!target_channel) return reply.code(400).send({ error: 'target_channel is required' })
    if (!VALID_CHANNELS.includes(target_channel)) {
      return reply.code(400).send({ error: `Invalid target_channel '${target_channel}'. Valid: ${VALID_CHANNELS.join(', ')}` })
    }

    const sourceSession = registry.get(req.params.id)!
    const oldChannel = sourceSession.browserChannel ?? 'chromium'

    // Step 1: Export state from source session (rollback-safe: source untouched until new session launches)
    let storageState: { cookies: any[]; origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> }
    try {
      storageState = await manager.getStorageState(req.params.id) as any
    } catch (err: any) {
      return reply.code(500).send({ error: `Failed to export storage state: ${err.message}` })
    }

    // Step 2: Create new session with target channel
    const resolvedChannel = target_channel !== 'chromium' ? target_channel : undefined
    const newId = registry.create({
      profile: sourceSession.profile,
      headless,
      browserChannel: resolvedChannel,
      launchMode: 'managed',
    })

    try {
      await manager.launchSession(newId, {
        profile: sourceSession.profile,
        headless,
        channel: resolvedChannel,
      })
    } catch (err: any) {
      // Rollback: clean up temp session, source session untouched
      await registry.close(newId)
      return reply.code(502).send({ error: `Target engine failed to start: ${err.message}`, old_channel: oldChannel, new_channel: target_channel })
    }

    // Step 3: Inject cookies into new session
    const cookies = storageState.cookies ?? []
    let cookieWarning: string | undefined
    try {
      if (cookies.length > 0) await manager.addCookies(newId, cookies)
    } catch (err: any) {
      cookieWarning = `Cookie transfer failed: ${err.message}`
    }

    // Step 4: Inject localStorage via initScript (deferred per origin)
    const origins = (storageState.origins ?? []).filter(o => o.localStorage?.length > 0)
    if (origins.length > 0) {
      const chunks = origins.map(o => {
        const kv = o.localStorage.map(item =>
          `localStorage.setItem(${JSON.stringify(item.name)},${JSON.stringify(item.value)})`
        ).join(';')
        return `if(location.origin===${JSON.stringify(o.origin)}){${kv}}`
      })
      try { await manager.addInitScript(newId, chunks.join(';')) } catch { /* non-fatal */ }
    }

    // Step 5: Close source session if not keeping it
    if (!keep_source) {
      if (manager) await manager.closeSession(req.params.id)
      await registry.close(req.params.id)
    }

    getLogger()?.write({
      session_id: newId,
      action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
      type: 'session',
      action: 'switch_engine',
      params: { source_session_id: req.params.id, old_channel: oldChannel, new_channel: target_channel, keep_source },
      result: { cookies_transferred: cookies.length, origins_transferred: origins.length },
    })

    return reply.code(200).send({
      session_id: newId,
      old_session_id: keep_source ? req.params.id : null,
      old_channel: oldChannel,
      new_channel: target_channel,
      profile: sourceSession.profile,
      headless,
      cookies_transferred: cookies.length,
      origins_transferred: origins.length,
      keep_source,
      ...(cookieWarning ? { warning: cookieWarning } : {}),
    })
  })

  // POST /api/v1/sessions/:id/seal — mark session as sealed (blocks DELETE)
  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/seal', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    try {
      registry.seal(req.params.id)
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
    return { status: 'ok', session_id: req.params.id, sealed: true }
  })

  // POST /api/v1/sessions/:id/unseal — T06: remove seal so session can be deleted
  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/unseal', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    try {
      registry.unseal(req.params.id)
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
    return { status: 'ok', session_id: req.params.id, sealed: false }
  })

  // POST /api/v1/sessions/:id/mode — switch headless/headed
  server.post<{
    Params: { id: string }
    Body: { mode: 'headless' | 'headed' }
  }>('/api/v1/sessions/:id/mode', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })

    const { mode } = req.body
    await manager.switchMode(req.params.id, mode === 'headed')
    return { session_id: req.params.id, mode }
  })

  // POST /api/v1/sessions/:id/handoff/start — open browser visually for human login
  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/handoff/start', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })

    await manager.switchMode(req.params.id, true /* headed */)
    return {
      session_id: req.params.id,
      mode: 'headed',
      message: 'Browser is now visible. Complete login and POST to handoff/complete to resume automation.',
    }
  })

  // POST /api/v1/sessions/:id/handoff/complete — return browser to headless after human login
  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/handoff/complete', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })

    await manager.switchMode(req.params.id, false /* headless */)
    return {
      session_id: req.params.id,
      mode: 'headless',
      message: 'Session returned to headless mode. Automation can resume.',
    }
  })

  // ---------------------------------------------------------------------------
  // Multi-page management (T03)
  // ---------------------------------------------------------------------------

  // GET /api/v1/sessions/:id/pages — list all open pages in a session
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/pages', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })
    return { session_id: req.params.id, pages: manager.listPages(req.params.id) }
  })

  // POST /api/v1/sessions/:id/pages — open a new tab/page
  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/pages', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })
    const page = await manager.createPage(req.params.id)
    return reply.code(201).send({ session_id: req.params.id, ...page })
  })

  // POST /api/v1/sessions/:id/pages/switch — make a page the active target
  server.post<{
    Params: { id: string }
    Body: { page_id: string }
  }>('/api/v1/sessions/:id/pages/switch', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })
    try {
      await manager.switchPage(req.params.id, req.body.page_id)
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
    return { session_id: req.params.id, active_page_id: req.body.page_id }
  })

  // DELETE /api/v1/sessions/:id/pages/:pageId — close a page
  server.delete<{ Params: { id: string; pageId: string } }>(
    '/api/v1/sessions/:id/pages/:pageId',
    async (req, reply) => {
      const s = registry.get(req.params.id)
      if (!s) return reply.code(404).send({ error: 'Not found' })
      const manager = server.browserManager
      if (manager) {
        try {
          await manager.closePage(req.params.id, req.params.pageId)
        } catch (err: any) {
          // r05-c05 P2: last-page guard → 409 Conflict
          if ((err as any).code === 'LAST_PAGE') {
            return reply.code(409).send({ error: err.message })
          }
          throw err
        }
      }
      return reply.code(204).send()
    },
  )

  function getLogger(): AuditLogger | undefined {
    return server.auditLogger
  }

  // GET /api/v1/sessions/:id/cdp — return CDP target info for the session's page
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/cdp', async (req, reply) => {
    const live = registry.getLive(req.params.id)
    if ('notFound' in live) return reply.code(404).send({ error: `Session not found: ${req.params.id}` })
    if ('zombie' in live) return reply.code(410).send({ error: 'Session browser is not running', state: 'zombie' })

    const { context, page } = live as any
    const cdpSession = await context.newCDPSession(page)
    try {
      const { targetInfos } = await cdpSession.send('Target.getTargets') as any
      getLogger()?.write({
        session_id: req.params.id,
        action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
        type: 'cdp',
        action: 'cdp_info',
        url: page.url(),
        params: { method: 'Target.getTargets' },
        result: { target_count: targetInfos.length },
      })
      return {
        session_id: req.params.id,
        url: page.url(),
        targets: targetInfos,
      }
    } finally {
      await cdpSession.detach()
    }
  })

  // ---------------------------------------------------------------------------
  // T06: CDP WebSocket native URL
  // ---------------------------------------------------------------------------

  // GET /api/v1/sessions/:id/cdp/ws — return browser-level CDP WebSocket URL
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/cdp/ws', async (req, reply) => {
    const live = registry.getLive(req.params.id)
    if ('notFound' in live) return reply.code(404).send({ error: `Session not found: ${req.params.id}` })
    if ('zombie' in live) return reply.code(410).send({ error: 'Session browser is not running', state: 'zombie' })

    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })

    const wsUrl = manager.getCdpWsUrl(req.params.id)
    getLogger()?.write({
      session_id: req.params.id,
      action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
      type: 'cdp',
      action: 'cdp_ws_url',
      url: (live as any).page?.url?.() ?? '',
      params: {},
      result: { ws_available: wsUrl !== null },
    })
    return {
      session_id: req.params.id,
      browser_ws_url: wsUrl,
      note: 'Connect directly to browser_ws_url for native CDP WebSocket access. Not proxied through daemon auth.',
    }
  })

  // ---------------------------------------------------------------------------
  // T07: Network route mock management
  // ---------------------------------------------------------------------------

  // GET /api/v1/sessions/:id/routes — list active route mocks
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/routes', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })
    return { session_id: req.params.id, routes: manager.listRoutes(req.params.id) }
  })

  // POST /api/v1/sessions/:id/route — register a route mock
  server.post<{
    Params: { id: string }
    Body: { pattern: string; mock: RouteMockConfig }
  }>('/api/v1/sessions/:id/route', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })
    const { pattern, mock } = req.body
    if (!pattern) return reply.code(400).send({ error: 'pattern is required' })
    try {
      await manager.addRoute(req.params.id, pattern, mock ?? {})
      getLogger()?.write({
        session_id: req.params.id,
        action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
        type: 'action',
        action: 'route_add',
        params: { pattern, mock },
        result: { status: 'ok' },
      })
      return reply.code(201).send({ session_id: req.params.id, pattern, mock })
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // DELETE /api/v1/sessions/:id/route — remove a route mock
  server.delete<{
    Params: { id: string }
    Body: { pattern: string }
  }>('/api/v1/sessions/:id/route', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })
    const { pattern } = req.body ?? {}
    if (!pattern) return reply.code(400).send({ error: 'pattern is required' })
    await manager.removeRoute(req.params.id, pattern)
    getLogger()?.write({
      session_id: req.params.id,
      action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
      type: 'action',
      action: 'route_remove',
      params: { pattern },
      result: { status: 'ok' },
    })
    return reply.code(204).send()
  })

  // POST /api/v1/sessions/:id/cdp — send a single CDP command and return the result
  server.post<{
    Params: { id: string }
    Body: { method: string; params?: Record<string, unknown>; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/cdp', async (req, reply) => {
    const live = registry.getLive(req.params.id)
    if ('notFound' in live) return reply.code(404).send({ error: `Session not found: ${req.params.id}` })
    if ('zombie' in live) return reply.code(410).send({ error: 'Session browser is not running', state: 'zombie' })

    const { method, params = {}, purpose, operator } = req.body
    if (!method) return reply.code(400).send({ error: 'method is required' })

    const { context, page } = live as any
    const cdpSession = await context.newCDPSession(page)
    try {
      const result = await cdpSession.send(method, params)
      getLogger()?.write({
        session_id: req.params.id,
        action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
        type: 'cdp',
        action: 'cdp_send',
        url: page.url(),
        params: { method },
        result: { status: 'ok' },
        purpose,
        operator,
      })
      return { result }
    } catch (err: any) {
      // T12: log full error internally; return sanitized message to caller
      getLogger()?.write({
        session_id: req.params.id,
        action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
        type: 'cdp',
        action: 'cdp_send',
        url: page.url(),
        params: { method },
        error: err.message, // full error in audit log
        purpose,
        operator,
      })
      return reply.code(400).send({ error: sanitizeCdpError(err.message) })
    } finally {
      await cdpSession.detach()
    }
  })

  // ---------------------------------------------------------------------------
  // T08: Playwright trace export
  // ---------------------------------------------------------------------------

  // POST /api/v1/sessions/:id/trace/start — begin Playwright trace recording
  server.post<{
    Params: { id: string }
    Body: { screenshots?: boolean; snapshots?: boolean }
  }>('/api/v1/sessions/:id/trace/start', async (req, reply) => {
    const live = registry.getLive(req.params.id)
    if ('notFound' in live) return reply.code(404).send({ error: `Session not found: ${req.params.id}` })
    if ('zombie' in live) return reply.code(410).send({ error: 'Session browser is not running', state: 'zombie' })

    const { screenshots = true, snapshots = true } = req.body ?? {}
    const { context } = live as any
    try {
      await context.tracing.start({ screenshots, snapshots })
      return { session_id: req.params.id, tracing: true, screenshots, snapshots }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // ---------------------------------------------------------------------------
  // r06-c02: Per-session safety policy override
  // ---------------------------------------------------------------------------

  // POST /api/v1/sessions/:id/policy — override the safety policy for this session
  server.post<{
    Params: { id: string }
    Body: { profile?: string; allow_sensitive_actions?: boolean }
  }>('/api/v1/sessions/:id/policy', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })

    const engine = server.policyEngine
    if (!engine) return reply.code(503).send({ error: 'Policy engine not initialized' })

    const profile = (req.body?.profile ?? 'safe') as PolicyProfileName
    const validProfiles = ['safe', 'permissive', 'disabled']
    if (!validProfiles.includes(profile)) {
      return reply.code(400).send({ error: `Invalid profile '${profile}'. Valid values: ${validProfiles.join(', ')}` })
    }

    const overrides = req.body?.allow_sensitive_actions !== undefined
      ? { allowSensitiveActions: req.body.allow_sensitive_actions }
      : undefined

    engine.setSessionPolicy(req.params.id, profile, overrides)

    const effective = engine.getSessionPolicy(req.params.id)
    getLogger()?.write({
      session_id: req.params.id,
      action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
      type: 'policy',
      action: 'policy_set',
      params: { profile, allow_sensitive_actions: effective.allowSensitiveActions },
      result: { status: 'ok' },
    })

    return {
      session_id: req.params.id,
      profile: effective.profile,
      domain_min_interval_ms: effective.domainMinIntervalMs,
      jitter_ms: effective.jitterMs,
      cooldown_after_error_ms: effective.cooldownAfterErrorMs,
      max_retries_per_domain: effective.maxRetriesPerDomain,
      max_actions_per_minute: effective.maxActionsPerMinute,
      allow_sensitive_actions: effective.allowSensitiveActions,
    }
  })

  // GET /api/v1/sessions/:id/policy — get current policy for this session
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/policy', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })

    const engine = server.policyEngine
    if (!engine) return reply.code(503).send({ error: 'Policy engine not initialized' })

    const effective = engine.getSessionPolicy(req.params.id)
    return {
      session_id: req.params.id,
      profile: effective.profile,
      domain_min_interval_ms: effective.domainMinIntervalMs,
      jitter_ms: effective.jitterMs,
      cooldown_after_error_ms: effective.cooldownAfterErrorMs,
      max_retries_per_domain: effective.maxRetriesPerDomain,
      max_actions_per_minute: effective.maxActionsPerMinute,
      allow_sensitive_actions: effective.allowSensitiveActions,
    }
  })

  // POST /api/v1/sessions/:id/trace/stop — stop trace and return base64-encoded ZIP
  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/trace/stop', async (req, reply) => {
    const live = registry.getLive(req.params.id)
    if ('notFound' in live) return reply.code(404).send({ error: `Session not found: ${req.params.id}` })
    if ('zombie' in live) return reply.code(410).send({ error: 'Session browser is not running', state: 'zombie' })

    const { context } = live as any
    const tmpPath = `/tmp/agentmb-trace-${req.params.id}.zip`
    try {
      await context.tracing.stop({ path: tmpPath })
      const { readFileSync, unlinkSync } = await import('fs')
      const buffer = readFileSync(tmpPath)
      unlinkSync(tmpPath)
      const t0 = Date.now()
      getLogger()?.write({
        session_id: req.params.id,
        action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
        type: 'action',
        action: 'trace_export',
        params: {},
        result: { size_bytes: buffer.length },
      })
      return {
        session_id: req.params.id,
        data: buffer.toString('base64'),
        format: 'zip',
        size_bytes: buffer.length,
      }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // ---------------------------------------------------------------------------
  // R08-R11: Browser Settings GET — viewport, UA, URL, headless
  // ---------------------------------------------------------------------------
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/settings', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })
    const live = registry.getLive(req.params.id)
    if ('notFound' in live || 'zombie' in live) return reply.code(410).send({ error: 'Session browser is not running' })
    const liveSess = live as any
    const viewport = liveSess.page?.viewportSize?.() ?? null
    const userAgent = await liveSess.page?.evaluate(() => navigator.userAgent).catch(() => null)
    const url = liveSess.page?.url?.() ?? null
    return {
      session_id: req.params.id,
      viewport,
      user_agent: userAgent,
      url,
      headless: s.headless,
      profile: s.profile,
    }
  })

  // ---------------------------------------------------------------------------
  // R10-T07: Runtime permission grant — browserContext.grantPermissions()
  // ---------------------------------------------------------------------------

  server.post<{
    Params: { id: string }
    Body: { permissions: string[]; origin?: string }
  }>('/api/v1/sessions/:id/grant-permission', async (req, reply) => {
    const live = registry.getLive(req.params.id)
    if ('notFound' in live) return reply.code(404).send({ error: `Session not found: ${req.params.id}` })
    if ('zombie' in live) return reply.code(410).send({ error: 'Session browser is not running', state: 'zombie' })

    const { permissions, origin } = req.body ?? {}
    if (!Array.isArray(permissions) || permissions.length === 0) {
      return reply.code(400).send({ error: 'permissions must be a non-empty array' })
    }

    const VALID_PERMISSIONS = new Set([
      'camera', 'microphone', 'notifications', 'geolocation',
      'clipboard-read', 'clipboard-write', 'accelerometer', 'background-sync',
      'magnetometer', 'gyroscope', 'midi', 'payment-handler', 'persistent-storage',
    ])
    const invalid = permissions.filter(p => !VALID_PERMISSIONS.has(p))
    if (invalid.length > 0) {
      return reply.code(400).send({ error: `Unknown permission(s): ${invalid.join(', ')}` })
    }

    try {
      const grantOpts = origin ? { origin } : {}
      await live.context.grantPermissions(permissions, grantOpts)
      return { status: 'ok', session_id: req.params.id, permissions, origin: origin ?? null }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ---------------------------------------------------------------------------
  // R08-R14 / R10-T05: Profile lifecycle — list + reset + delete (with zone)
  // ---------------------------------------------------------------------------

  /**
   * zone 'managed' → profiles/ (Playwright-managed Chromium)
   * zone 'stable'  → chrome-profiles/ (Chrome/Edge native browser)
   */
  function getZoneDir(zone: 'managed' | 'stable'): string {
    const dataDir = process.env.AGENTMB_DATA_DIR ?? path.join(os.homedir(), '.agentmb')
    return zone === 'stable'
      ? path.join(dataDir, 'chrome-profiles')
      : path.join(dataDir, 'profiles')
  }

  /** Recursively sum file sizes in a directory. */
  async function dirSize(dirPath: string): Promise<number> {
    let total = 0
    try {
      const items = await fs.promises.readdir(dirPath, { withFileTypes: true })
      await Promise.all(items.map(async (item) => {
        const fullPath = path.join(dirPath, item.name)
        if (item.isDirectory()) {
          total += await dirSize(fullPath)
        } else if (item.isFile()) {
          try { total += (await fs.promises.stat(fullPath)).size } catch { /* ignore */ }
        }
      }))
    } catch { /* ignore */ }
    return total
  }

  /** Scan one zone directory and return enriched profile entries. */
  async function listZoneProfiles(zone: 'managed' | 'stable'): Promise<Array<{
    zone: string; name: string; path: string; size_bytes: number; sessions_live: number; session_ids: string[]; last_modified: string | null
  }>> {
    const dir = getZoneDir(zone)
    if (!fs.existsSync(dir)) return []
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    return Promise.all(
      entries
        .filter(e => e.isDirectory())
        .map(async (e) => {
          const profilePath = path.join(dir, e.name)
          let last_modified: string | null = null
          try {
            const stat = await fs.promises.stat(profilePath)
            last_modified = stat.mtime.toISOString()
          } catch { /* ignore */ }
          const size_bytes = await dirSize(profilePath)
          const liveSessions = registry.list().filter(
            s => s.profile === e.name && s.state === 'live'
          )
          return {
            zone,
            name: e.name,
            path: profilePath,
            size_bytes,
            sessions_live: liveSessions.length,
            session_ids: liveSessions.map(s => s.id),
            last_modified,
          }
        }),
    )
  }

  // GET /api/v1/profiles[?zone=managed|stable] — list profiles with zone/size/session info
  server.get<{ Querystring: { zone?: string } }>('/api/v1/profiles', async (req, reply) => {
    const { zone } = req.query ?? {}
    if (zone && zone !== 'managed' && zone !== 'stable') {
      return reply.code(400).send({ error: "zone must be 'managed' or 'stable'" })
    }
    try {
      let profiles: Awaited<ReturnType<typeof listZoneProfiles>> = []
      if (!zone || zone === 'managed') profiles = profiles.concat(await listZoneProfiles('managed'))
      if (!zone || zone === 'stable') profiles = profiles.concat(await listZoneProfiles('stable'))
      return { profiles, count: profiles.length }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // DELETE /api/v1/profiles/:name[?zone=managed|stable][&force=true] — T05 profile delete
  server.delete<{
    Params: { name: string }
    Querystring: { zone?: string; force?: string }
  }>('/api/v1/profiles/:name', async (req, reply) => {
    const { name } = req.params
    const zone = (req.query.zone ?? 'managed') as 'managed' | 'stable'
    const force = req.query.force === 'true'

    if (!/^[\w\-]+$/.test(name)) return reply.code(400).send({ error: 'Invalid profile name; only alphanumeric, dash, underscore allowed' })
    if (zone !== 'managed' && zone !== 'stable') {
      return reply.code(400).send({ error: "zone must be 'managed' or 'stable'" })
    }

    const dir = getZoneDir(zone)
    const profilePath = path.join(dir, name)
    // Safety: no path traversal
    if (!profilePath.startsWith(dir + path.sep)) return reply.code(400).send({ error: 'Invalid profile name' })

    if (!fs.existsSync(profilePath)) {
      // R10-C07: cross-zone hint — check if profile exists in the other zone (Issue #13)
      const otherZone = zone === 'managed' ? 'stable' : 'managed'
      const otherPath = path.join(getZoneDir(otherZone), name)
      const hint = fs.existsSync(otherPath)
        ? `Profile '${name}' exists in zone '${otherZone}'. Try adding --zone ${otherZone}.`
        : undefined
      const body: Record<string, string> = { error: `Profile '${name}' not found in zone '${zone}'` }
      if (hint) body.hint = hint
      return reply.code(404).send(body)
    }

    // Destruction protection: check for live sessions
    const liveSessions = registry.list().filter(s => s.profile === name && s.state === 'live')
    if (liveSessions.length > 0 && !force) {
      return reply.code(423).send({
        error: 'profile_locked',
        message: `Profile '${name}' has ${liveSessions.length} live session(s). Use --force to override.`,
        session_ids: liveSessions.map(s => s.id),
      })
    }

    try {
      if (force && liveSessions.length > 0) {
        const manager = server.browserManager
        for (const s of liveSessions) {
          if (manager) await manager.closeSession(s.id)
          await registry.close(s.id)
        }
      }

      await removeProfileDirWithRetry(profilePath)
      return reply.code(204).send()
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  server.post<{ Params: { name: string } }>('/api/v1/profiles/:name/reset', async (req, reply) => {
    const { name } = req.params
    if (!/^[\w\-]+$/.test(name)) return reply.code(400).send({ error: 'Invalid profile name; only alphanumeric, dash, underscore allowed' })
    const dir = getZoneDir('managed')
    const profilePath = path.join(dir, name)
    // Safety: ensure profilePath is inside dir (no path traversal)
    if (!profilePath.startsWith(dir + path.sep)) return reply.code(400).send({ error: 'Invalid profile name' })
    // Check if any live session is using this profile
    const liveSessions = registry.list().filter(s => s.profile === name && s.state === 'live')
    if (liveSessions.length > 0) {
      return reply.code(409).send({
        error: 'profile_in_use',
        message: `Profile '${name}' is currently used by ${liveSessions.length} live session(s). Close those sessions first.`,
        session_ids: liveSessions.map(s => s.id),
      })
    }
    try {
      if (fs.existsSync(profilePath)) {
        await fs.promises.rm(profilePath, { recursive: true, force: true })
      }
      await fs.promises.mkdir(profilePath, { recursive: true })
      return { status: 'ok', profile: name, message: `Profile '${name}' reset (cookies and storage cleared)` }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ---------------------------------------------------------------------------
  // R09-C04-T14: Local awareness — /utils/ls file scan
  // ---------------------------------------------------------------------------

  interface LsEntry { name: string; type: 'file' | 'dir'; path: string; size?: number; children?: LsEntry[] }

  async function scanDir(dirPath: string, depth: number): Promise<LsEntry[]> {
    const entries: LsEntry[] = []
    let items: fs.Dirent[]
    try { items = await fs.promises.readdir(dirPath, { withFileTypes: true }) } catch { return [] }
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name)
      if (item.isDirectory()) {
        const entry: LsEntry = { name: item.name, type: 'dir', path: fullPath }
        if (depth > 1) entry.children = await scanDir(fullPath, depth - 1)
        entries.push(entry)
      } else if (item.isFile()) {
        let size: number | undefined
        try { size = (await fs.promises.stat(fullPath)).size } catch { /* ignore */ }
        entries.push({ name: item.name, type: 'file', path: fullPath, size })
      }
    }
    return entries
  }

  /** Shared ls handler — used by both GET and POST endpoints. */
  async function handleLs(
    bm: import('../../browser/manager').BrowserManager | undefined,
    session_id: string, reqPath: string, depthStr: string | undefined, reply: any,
  ): Promise<any> {
    if (!bm) return reply.code(503).send({ error: 'Browser manager not initialized' })
    if (!session_id) return reply.code(400).send({ error: 'session_id is required' })
    if (!reqPath) return reply.code(400).send({ error: 'path is required' })
    const s = registry.get(session_id)
    if (!s) return reply.code(404).send({ error: `Session ${session_id} not found` })
    const allowDirs = bm.getAllowDirs(session_id)
    if (allowDirs.length === 0) {
      return reply.code(403).send({ error: 'No allowed directories for this session. Set allow_dirs when creating session.' })
    }
    // R09-C07-P0: resolve symlinks via realpath to prevent symlink traversal attacks.
    // path.resolve() only does string manipulation; fs.realpath follows symlinks on disk.
    let abs: string
    try {
      abs = await fs.promises.realpath(reqPath)
    } catch {
      return reply.code(404).send({ error: `Path ${reqPath} does not exist or is not accessible.` })
    }
    const allowed = allowDirs.some(d => abs === d || abs.startsWith(d + path.sep))
    if (!allowed) {
      return reply.code(403).send({ error: `Path ${reqPath} is not within allowed directories.` })
    }
    const depth = Math.min(parseInt(depthStr ?? '1', 10) || 1, 5)
    const entries = await scanDir(abs, depth)
    return { path: abs, entries, session_id }
  }

  // GET variant (query params — ASCII paths, backward compatible)
  server.get<{
    Querystring: { session_id: string; path: string; depth?: string }
  }>('/api/v1/utils/ls', async (req, reply) => {
    const { session_id, path: reqPath, depth: depthStr } = req.query
    return handleLs(server.browserManager, session_id, reqPath, depthStr, reply)
  })

  // POST variant (JSON body — supports non-ASCII / Unicode paths, R09-C06-P2)
  server.post<{
    Body: { session_id: string; path: string; depth?: number }
  }>('/api/v1/utils/ls', async (req, reply) => {
    const { session_id, path: reqPath, depth } = req.body ?? {}
    return handleLs(server.browserManager, session_id, reqPath, depth !== undefined ? String(depth) : undefined, reply)
  })

  // ---------------------------------------------------------------------------
  // R09-C04-T08: Video recording endpoints
  // ---------------------------------------------------------------------------

  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/video', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })
    const videoPath = await manager.getVideoPath(req.params.id)
    return { session_id: req.params.id, video_path: videoPath }
  })

  server.post<{
    Params: { id: string }
    Body: { dest_path: string }
  }>('/api/v1/sessions/:id/video/save', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager = server.browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })
    const videoPath = await manager.getVideoPath(req.params.id)
    if (!videoPath) return reply.code(404).send({ error: 'No video available for this session. Ensure record_video=true was set on session creation.' })
    const { dest_path } = req.body ?? {}
    if (!dest_path) return reply.code(400).send({ error: 'dest_path is required' })
    try {
      await fs.promises.mkdir(path.dirname(dest_path), { recursive: true })
      await fs.promises.copyFile(videoPath, dest_path)
      return { session_id: req.params.id, saved_to: dest_path, source: videoPath }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
