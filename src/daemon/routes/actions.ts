import { FastifyInstance, FastifyReply } from 'fastify'
import { SessionRegistry, LiveSession, SessionInfo } from '../session'
import { BrowserContext, Page, Frame } from 'playwright-core'

type ReadySession = LiveSession & { context: BrowserContext; page: Page }
import { AuditLogger } from '../../audit/logger'
import * as Actions from '../../browser/actions'
import { ActionDiagnosticsError, Actionable } from '../../browser/actions'

// ---------------------------------------------------------------------------
// Frame resolution (T04)
// ---------------------------------------------------------------------------

interface FrameSelector {
  type: 'name' | 'url' | 'nth'
  value: string | number
}

function resolveFrame(page: Page, frame?: FrameSelector): Actionable {
  if (!frame) return page
  let f: Frame | null = null
  if (frame.type === 'name') f = page.frame({ name: frame.value as string })
  else if (frame.type === 'url') f = page.frame({ url: frame.value as string })
  else if (frame.type === 'nth') f = page.frames()[frame.value as number] ?? null
  return f ?? page
}

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
        error: `Session ${id} exists but browser is not running. Run 'agentmb session new --profile ${info.profile}' to relaunch.`,
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
    Body: { url: string; wait_until?: 'load' | 'networkidle' | 'commit' | 'domcontentloaded'; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/navigate', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { url, wait_until = 'load', purpose, operator } = req.body
    return Actions.navigate(s.page, url, wait_until, getLogger(), s.id, purpose, operator)
  })

  // POST /api/v1/sessions/:id/click
  server.post<{
    Params: { id: string }
    Body: { selector: string; timeout_ms?: number; frame?: FrameSelector; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/click', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, timeout_ms = 5000, frame, purpose, operator } = req.body
    return Actions.click(resolveFrame(s.page, frame), selector, timeout_ms, getLogger(), s.id, purpose, operator)
  })

  // POST /api/v1/sessions/:id/fill
  server.post<{
    Params: { id: string }
    Body: { selector: string; value: string; frame?: FrameSelector; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/fill', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, value, frame, purpose, operator } = req.body
    return Actions.fill(resolveFrame(s.page, frame), selector, value, getLogger(), s.id, purpose, operator)
  })

  // POST /api/v1/sessions/:id/eval
  server.post<{
    Params: { id: string }
    Body: { expression: string; frame?: FrameSelector; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/eval', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { expression, frame, purpose, operator } = req.body
    try {
      return await Actions.evaluate(resolveFrame(s.page, frame), expression, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/extract — safe selector-based content extraction
  server.post<{
    Params: { id: string }
    Body: { selector: string; attribute?: string; frame?: FrameSelector; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/extract', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, attribute, frame, purpose, operator } = req.body
    try {
      return await Actions.extract(resolveFrame(s.page, frame), selector, attribute, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/screenshot
  server.post<{
    Params: { id: string }
    Body: { format?: 'png' | 'jpeg'; full_page?: boolean; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/screenshot', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { format = 'png', full_page = false, purpose, operator } = req.body ?? {}
    try {
      return await Actions.screenshot(s.page, format, full_page, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/type
  server.post<{
    Params: { id: string }
    Body: { selector: string; text: string; delay_ms?: number; frame?: FrameSelector; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/type', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, text, delay_ms = 0, frame, purpose, operator } = req.body
    try {
      return await Actions.typeText(resolveFrame(s.page, frame), selector, text, delay_ms, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/press
  server.post<{
    Params: { id: string }
    Body: { selector: string; key: string; frame?: FrameSelector; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/press', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, key, frame, purpose, operator } = req.body
    try {
      return await Actions.press(resolveFrame(s.page, frame), selector, key, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/select
  server.post<{
    Params: { id: string }
    Body: { selector: string; values: string[]; frame?: FrameSelector; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/select', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, values, frame, purpose, operator } = req.body
    try {
      return await Actions.selectOption(resolveFrame(s.page, frame), selector, values, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/hover
  server.post<{
    Params: { id: string }
    Body: { selector: string; frame?: FrameSelector; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/hover', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, frame, purpose, operator } = req.body
    try {
      return await Actions.hover(resolveFrame(s.page, frame), selector, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/wait_for_selector
  server.post<{
    Params: { id: string }
    Body: { selector: string; state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout_ms?: number; frame?: FrameSelector; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/wait_for_selector', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, state = 'visible', timeout_ms = 5000, frame, purpose, operator } = req.body
    try {
      return await Actions.waitForSelector(resolveFrame(s.page, frame), selector, state, timeout_ms, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/wait_for_url
  server.post<{
    Params: { id: string }
    Body: { url_pattern: string; timeout_ms?: number; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/wait_for_url', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { url_pattern, timeout_ms = 5000, purpose, operator } = req.body
    try {
      return await Actions.waitForUrl(s.page, url_pattern, timeout_ms, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/wait_for_response
  server.post<{
    Params: { id: string }
    Body: {
      url_pattern: string
      timeout_ms?: number
      trigger?: { type: 'navigate'; url: string; wait_until?: string }
      purpose?: string
      operator?: string
    }
  }>('/api/v1/sessions/:id/wait_for_response', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { url_pattern, timeout_ms = 10000, trigger, purpose, operator } = req.body
    const triggerArg = trigger ? { type: trigger.type as 'navigate', url: trigger.url, waitUntil: trigger.wait_until as any } : undefined
    try {
      return await Actions.waitForResponse(s.page, url_pattern, timeout_ms, triggerArg, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/upload
  server.post<{
    Params: { id: string }
    Body: { selector: string; content: string; filename: string; mime_type?: string; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/upload', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, content, filename, mime_type = 'application/octet-stream', purpose, operator } = req.body
    // Guard: base64 content must not exceed 50 MB decoded
    const approxBytes = Math.floor(content.length * 0.75)
    if (approxBytes > 50 * 1024 * 1024) {
      return reply.code(413).send({ error: 'File too large: maximum upload size is 50 MB' })
    }
    try {
      return await Actions.uploadFile(s.page, selector, content, filename, mime_type, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/download
  server.post<{
    Params: { id: string }
    Body: { selector: string; timeout_ms?: number; max_bytes?: number; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/download', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, timeout_ms = 30000, max_bytes = 50 * 1024 * 1024, purpose, operator } = req.body
    try {
      return await Actions.downloadFile(s.page, selector, timeout_ms, max_bytes, getLogger(), s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
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
