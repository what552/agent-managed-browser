import { FastifyInstance } from 'fastify'
import { SessionRegistry } from '../session'
import { BrowserManager } from '../../browser/manager'

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
}
