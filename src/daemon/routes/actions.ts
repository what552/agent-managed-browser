import { FastifyInstance, FastifyReply } from 'fastify'
import { SessionRegistry, LiveSession, SessionInfo } from '../session'
import { BrowserContext, Page } from 'playwright-core'

type ReadySession = LiveSession & { context: BrowserContext; page: Page }
import { AuditLogger } from '../../audit/logger'
import * as Actions from '../../browser/actions'

export function registerActionRoutes(server: FastifyInstance, registry: SessionRegistry): void {
  function getLogger(): AuditLogger | undefined {
    return (server as any).auditLogger
  }

  /** Resolve a live session or send 404/410 and return null */
  function resolve(id: string, reply: FastifyReply): ReadySession | null {
    const result = registry.getLive(id)
    if ('notFound' in result) {
      reply.code(404).send({ error: `Session not found: ${id}` })
      return null
    }
    if ('zombie' in result) {
      const info = result.info as SessionInfo
      reply.code(410).send({
        error: `Session ${id} exists but browser is not running. Run 'openclaw session new --profile ${info.profile}' to relaunch.`,
        state: 'zombie',
        profile: info.profile,
      })
      return null
    }
    return result as ReadySession
  }

  // POST /api/v1/sessions/:id/navigate
  server.post<{
    Params: { id: string }
    Body: { url: string; wait_until?: 'load' | 'networkidle' | 'commit' | 'domcontentloaded' }
  }>('/api/v1/sessions/:id/navigate', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { url, wait_until = 'load' } = req.body
    return Actions.navigate(s.page, url, wait_until, getLogger(), s.id)
  })

  // POST /api/v1/sessions/:id/click
  server.post<{
    Params: { id: string }
    Body: { selector: string; timeout_ms?: number }
  }>('/api/v1/sessions/:id/click', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, timeout_ms = 5000 } = req.body
    return Actions.click(s.page, selector, timeout_ms, getLogger(), s.id)
  })

  // POST /api/v1/sessions/:id/fill
  server.post<{
    Params: { id: string }
    Body: { selector: string; value: string }
  }>('/api/v1/sessions/:id/fill', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, value } = req.body
    return Actions.fill(s.page, selector, value, getLogger(), s.id)
  })

  // POST /api/v1/sessions/:id/eval
  server.post<{
    Params: { id: string }
    Body: { expression: string }
  }>('/api/v1/sessions/:id/eval', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    return Actions.evaluate(s.page, req.body.expression, getLogger(), s.id)
  })

  // POST /api/v1/sessions/:id/extract — safe selector-based content extraction
  server.post<{
    Params: { id: string }
    Body: { selector: string; attribute?: string }
  }>('/api/v1/sessions/:id/extract', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, attribute } = req.body
    return Actions.extract(s.page, selector, attribute, getLogger(), s.id)
  })

  // POST /api/v1/sessions/:id/screenshot
  server.post<{
    Params: { id: string }
    Body: { format?: 'png' | 'jpeg'; full_page?: boolean }
  }>('/api/v1/sessions/:id/screenshot', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { format = 'png', full_page = false } = req.body ?? {}
    return Actions.screenshot(s.page, format, full_page, getLogger(), s.id)
  })

  // GET /api/v1/sessions/:id/logs
  server.get<{
    Params: { id: string }
    Querystring: { tail?: string; since?: string }
  }>('/api/v1/sessions/:id/logs', async (req, reply) => {
    // 404 check: we still want logs for a just-closed session → skip session check
    const logger = getLogger()
    if (!logger) return reply.code(503).send({ error: 'Audit logger not initialized' })
    const tail = req.query.tail ? parseInt(req.query.tail) : 50
    return logger.tail(req.params.id, tail)
  })
}
