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
    }
  }>('/api/v1/sessions', async (req, reply) => {
    const {
      profile, headless = true, agent_id, accept_downloads = false,
      ephemeral, browser_channel, executable_path,
      launch_mode, cdp_url,
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
      launchMode: launch_mode, cdpUrl: cdp_url,
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
    })
  })

  // GET /api/v1/sessions — list (normalized to snake_case for SDK)
  server.get('/api/v1/sessions', async () => {
    return registry.list().map((s) => ({
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
    }))
  })

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
  server.delete<{ Params: { id: string } }>('/api/v1/sessions/:id', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    if (s.sealed) {
      return reply.code(423).send({ error: 'session_sealed', message: 'Session is sealed and cannot be deleted. Use seal=false if you need to unseal.' })
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
      manager.switchPage(req.params.id, req.body.page_id)
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
  // R08-R14: Profile lifecycle — list + reset
  // ---------------------------------------------------------------------------

  function getProfilesDir(): string {
    const dataDir = process.env.AGENTMB_DATA_DIR ?? path.join(os.homedir(), '.agentmb')
    return path.join(dataDir, 'profiles')
  }

  server.get('/api/v1/profiles', async (_req, reply) => {
    const dir = getProfilesDir()
    try {
      if (!fs.existsSync(dir)) return { profiles: [], count: 0 }
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      const profiles = await Promise.all(
        entries
          .filter(e => e.isDirectory())
          .map(async (e) => {
            const profilePath = path.join(dir, e.name)
            let last_used: string | null = null
            try {
              const stat = await fs.promises.stat(profilePath)
              last_used = stat.mtime.toISOString()
            } catch { /* ignore */ }
            return { name: e.name, path: profilePath, last_used }
          }),
      )
      return { profiles, count: profiles.length }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  server.post<{ Params: { name: string } }>('/api/v1/profiles/:name/reset', async (req, reply) => {
    const { name } = req.params
    if (!/^[\w\-]+$/.test(name)) return reply.code(400).send({ error: 'Invalid profile name; only alphanumeric, dash, underscore allowed' })
    const dir = getProfilesDir()
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
}
