import crypto from 'crypto'
import { FastifyInstance } from 'fastify'
import { SessionRegistry } from '../session'
import { BrowserManager } from '../../browser/manager'
import { AuditLogger } from '../../audit/logger'

export function registerSessionRoutes(server: FastifyInstance, registry: SessionRegistry): void {
  // POST /api/v1/sessions — create session
  server.post<{
    Body: { profile?: string; headless?: boolean; agent_id?: string }
  }>('/api/v1/sessions', async (req, reply) => {
    const { profile, headless = true, agent_id } = req.body ?? {}

    const manager: BrowserManager = (server as any).browserManager
    if (!manager) {
      return reply.code(503).send({ error: 'Browser manager not initialized' })
    }

    const id = registry.create({ profile, headless, agentId: agent_id })
    try {
      await manager.launchSession(id, { profile, headless })
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
    }
  })

  // DELETE /api/v1/sessions/:id
  server.delete<{ Params: { id: string } }>('/api/v1/sessions/:id', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    // Clean up BrowserManager internal state first, then registry
    const manager: BrowserManager = (server as any).browserManager
    if (manager) await manager.closeSession(req.params.id)
    await registry.close(req.params.id)
    return reply.code(204).send()
  })

  // POST /api/v1/sessions/:id/mode — switch headless/headed
  server.post<{
    Params: { id: string }
    Body: { mode: 'headless' | 'headed' }
  }>('/api/v1/sessions/:id/mode', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager: BrowserManager = (server as any).browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })

    const { mode } = req.body
    await manager.switchMode(req.params.id, mode === 'headed')
    return { session_id: req.params.id, mode }
  })

  // POST /api/v1/sessions/:id/handoff/start — open browser visually for human login
  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/handoff/start', async (req, reply) => {
    const s = registry.get(req.params.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    const manager: BrowserManager = (server as any).browserManager
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
    const manager: BrowserManager = (server as any).browserManager
    if (!manager) return reply.code(503).send({ error: 'Browser manager not initialized' })

    await manager.switchMode(req.params.id, false /* headless */)
    return {
      session_id: req.params.id,
      mode: 'headless',
      message: 'Session returned to headless mode. Automation can resume.',
    }
  })

  function getLogger(): AuditLogger | undefined {
    return (server as any).auditLogger
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
      getLogger()?.write({
        session_id: req.params.id,
        action_id: 'act_' + crypto.randomBytes(6).toString('hex'),
        type: 'cdp',
        action: 'cdp_send',
        url: page.url(),
        params: { method },
        error: err.message,
        purpose,
        operator,
      })
      return reply.code(400).send({ error: err.message })
    } finally {
      await cdpSession.detach()
    }
  })
}
