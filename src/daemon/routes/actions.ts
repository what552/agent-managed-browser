import { FastifyInstance } from 'fastify'
import { SessionRegistry } from '../session'
import { AuditLogger } from '../../audit/logger'
import * as Actions from '../../browser/actions'

export function registerActionRoutes(server: FastifyInstance, registry: SessionRegistry): void {
  function getLogger(): AuditLogger | undefined {
    return (server as any).auditLogger
  }

  // POST /api/v1/sessions/:id/navigate
  server.post<{
    Params: { id: string }
    Body: { url: string; wait_until?: 'load' | 'networkidle' | 'commit' | 'domcontentloaded' }
  }>('/api/v1/sessions/:id/navigate', async (req, reply) => {
    const s = registry.getOrThrow(req.params.id)
    const { url, wait_until = 'load' } = req.body
    const result = await Actions.navigate(s.page, url, wait_until, getLogger(), s.id)
    return result
  })

  // POST /api/v1/sessions/:id/click
  server.post<{
    Params: { id: string }
    Body: { selector: string; timeout_ms?: number }
  }>('/api/v1/sessions/:id/click', async (req, reply) => {
    const s = registry.getOrThrow(req.params.id)
    const { selector, timeout_ms = 5000 } = req.body
    return Actions.click(s.page, selector, timeout_ms, getLogger(), s.id)
  })

  // POST /api/v1/sessions/:id/fill
  server.post<{
    Params: { id: string }
    Body: { selector: string; value: string }
  }>('/api/v1/sessions/:id/fill', async (req, reply) => {
    const s = registry.getOrThrow(req.params.id)
    const { selector, value } = req.body
    return Actions.fill(s.page, selector, value, getLogger(), s.id)
  })

  // POST /api/v1/sessions/:id/eval
  server.post<{
    Params: { id: string }
    Body: { expression: string }
  }>('/api/v1/sessions/:id/eval', async (req, reply) => {
    const s = registry.getOrThrow(req.params.id)
    return Actions.evaluate(s.page, req.body.expression, getLogger(), s.id)
  })

  // POST /api/v1/sessions/:id/screenshot
  server.post<{
    Params: { id: string }
    Body: { format?: 'png' | 'jpeg'; full_page?: boolean }
  }>('/api/v1/sessions/:id/screenshot', async (req, reply) => {
    const s = registry.getOrThrow(req.params.id)
    const { format = 'png', full_page = false } = req.body ?? {}
    return Actions.screenshot(s.page, format, full_page, getLogger(), s.id)
  })

  // GET /api/v1/sessions/:id/logs
  server.get<{
    Params: { id: string }
    Querystring: { tail?: string; since?: string }
  }>('/api/v1/sessions/:id/logs', async (req, reply) => {
    const logger = getLogger()
    if (!logger) return reply.code(503).send({ error: 'Audit logger not initialized' })
    const tail = req.query.tail ? parseInt(req.query.tail) : 50
    return logger.tail(req.params.id, tail)
  })
}
