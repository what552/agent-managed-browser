import crypto from 'crypto'
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SessionRegistry, LiveSession, SessionInfo } from '../session'
import { BrowserContext, Page, Frame } from 'playwright-core'
import '../types' // T11: Fastify type augmentation

type ReadySession = LiveSession & { context: BrowserContext; page: Page }
import { AuditLogger } from '../../audit/logger'
import * as Actions from '../../browser/actions'
import { ActionDiagnosticsError, Actionable } from '../../browser/actions'
import { extractDomain } from '../../policy/engine'

// ---------------------------------------------------------------------------
// Frame resolution (T04 / r05-c05 P1: no silent fallback on missing frame)
// ---------------------------------------------------------------------------

interface FrameSelector {
  type: 'name' | 'url' | 'nth'
  value: string | number
}

/** Structured error when a frame selector matches no frame in the page. */
class FrameResolutionError extends Error {
  readonly selector: FrameSelector
  readonly availableFrames: Array<{ name: string; url: string }>
  constructor(page: Page, selector: FrameSelector) {
    super(`Frame not found: type='${selector.type}', value='${String(selector.value)}'`)
    this.name = 'FrameResolutionError'
    this.selector = selector
    this.availableFrames = page.frames().map((f) => ({ name: f.name(), url: f.url() }))
  }
}

/**
 * Resolve a frame selector to an Actionable target.
 * Throws FrameResolutionError (→ 422) if a frame selector is given but no
 * matching frame is found. Does NOT fall back silently to the main page.
 */
function resolveFrame(page: Page, frame?: FrameSelector): Actionable {
  if (!frame) return page
  let f: Frame | null = null
  if (frame.type === 'name') f = page.frame({ name: frame.value as string })
  else if (frame.type === 'url') f = page.frame({ url: frame.value as string })
  else if (frame.type === 'nth') f = page.frames()[frame.value as number] ?? null
  if (!f) throw new FrameResolutionError(page, frame)
  return f
}

/**
 * Resolve a frame selector and, if resolution fails, send a 422 and return
 * null so the caller can early-return. Avoids repeating try/catch everywhere.
 */
function resolveOrReply(
  page: Page,
  frame: FrameSelector | undefined,
  reply: FastifyReply,
): Actionable | null {
  try {
    return resolveFrame(page, frame)
  } catch (e) {
    if (e instanceof FrameResolutionError) {
      reply.code(422).send({
        error: e.message,
        frame_selector: e.selector,
        available_frames: e.availableFrames,
      })
      return null
    }
    throw e
  }
}

// ---------------------------------------------------------------------------
// T09: operator auto-inference
// ---------------------------------------------------------------------------

/**
 * Infer the operator string from (in order of precedence):
 * 1. Explicitly provided in request body
 * 2. X-Operator request header
 * 3. Session's agent_id
 * 4. Fallback: 'agentmb-daemon'
 */
function inferOperator(
  req: FastifyRequest,
  s: { agentId?: string | null },
  explicit?: string,
): string {
  if (explicit) return explicit
  const xOp = req.headers['x-operator'] as string | undefined
  if (xOp) return xOp
  if (s.agentId) return s.agentId
  return 'agentmb-daemon'
}

// ---------------------------------------------------------------------------
// r06-c02: Policy check helper
// ---------------------------------------------------------------------------

/**
 * Run a policy check before executing an action.
 * Returns true if the action is allowed (possibly after waiting for throttle/jitter).
 * Returns false and sends a 403 response if the action is denied.
 */
async function applyPolicy(
  server: FastifyInstance,
  sessionId: string,
  domain: string,
  action: string,
  opts: { sensitive?: boolean; retry?: boolean },
  reply: FastifyReply,
): Promise<boolean> {
  const engine = server.policyEngine
  if (!engine) return true

  const result = await engine.checkAndWait({
    sessionId,
    domain,
    action,
    sensitive: opts.sensitive,
    retry: opts.retry,
    auditLogger: server.auditLogger,
  })

  if (!result.allowed) {
    reply.code(403).send({
      error: result.reason,
      policy_event: result.policyEvent,
      domain,
    })
    return false
  }

  return true
}

export function registerActionRoutes(server: FastifyInstance, registry: SessionRegistry): void {
  function getLogger(): AuditLogger | undefined {
    return server.auditLogger
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
    Body: { url: string; wait_until?: 'load' | 'networkidle' | 'commit' | 'domcontentloaded'; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean }
  }>('/api/v1/sessions/:id/navigate', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { url, wait_until = 'load', purpose, operator, sensitive, retry } = req.body
    const domain = extractDomain(url)
    if (!await applyPolicy(server, req.params.id, domain, 'navigate', { sensitive, retry }, reply)) return
    return Actions.navigate(s.page, url, wait_until, getLogger(), s.id, purpose, inferOperator(req, s, operator))
  })

  // POST /api/v1/sessions/:id/click
  server.post<{
    Params: { id: string }
    Body: { selector: string; timeout_ms?: number; frame?: FrameSelector; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean }
  }>('/api/v1/sessions/:id/click', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, timeout_ms = 5000, frame, purpose, operator, sensitive, retry } = req.body
    if (!await applyPolicy(server, req.params.id, extractDomain(s.page.url()), 'click', { sensitive, retry }, reply)) return
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    return Actions.click(target, selector, timeout_ms, getLogger(), s.id, purpose, inferOperator(req, s, operator))
  })

  // POST /api/v1/sessions/:id/fill
  server.post<{
    Params: { id: string }
    Body: { selector: string; value: string; frame?: FrameSelector; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean }
  }>('/api/v1/sessions/:id/fill', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, value, frame, purpose, operator, sensitive, retry } = req.body
    if (!await applyPolicy(server, req.params.id, extractDomain(s.page.url()), 'fill', { sensitive, retry }, reply)) return
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    return Actions.fill(target, selector, value, getLogger(), s.id, purpose, inferOperator(req, s, operator))
  })

  // POST /api/v1/sessions/:id/eval
  server.post<{
    Params: { id: string }
    Body: { expression: string; frame?: FrameSelector; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean }
  }>('/api/v1/sessions/:id/eval', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { expression, frame, purpose, operator, sensitive, retry } = req.body
    if (!await applyPolicy(server, req.params.id, extractDomain(s.page.url()), 'eval', { sensitive, retry }, reply)) return
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    try {
      return await Actions.evaluate(target, expression, getLogger(), s.id, purpose, inferOperator(req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/extract — safe selector-based content extraction
  server.post<{
    Params: { id: string }
    Body: { selector: string; attribute?: string; frame?: FrameSelector; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean }
  }>('/api/v1/sessions/:id/extract', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, attribute, frame, purpose, operator, sensitive, retry } = req.body
    if (!await applyPolicy(server, req.params.id, extractDomain(s.page.url()), 'extract', { sensitive, retry }, reply)) return
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    try {
      return await Actions.extract(target, selector, attribute, getLogger(), s.id, purpose, inferOperator(req, s, operator))
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
      return await Actions.screenshot(s.page, format, full_page, getLogger(), s.id, purpose, inferOperator(req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/type
  server.post<{
    Params: { id: string }
    Body: { selector: string; text: string; delay_ms?: number; frame?: FrameSelector; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean }
  }>('/api/v1/sessions/:id/type', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, text, delay_ms = 0, frame, purpose, operator, sensitive, retry } = req.body
    if (!await applyPolicy(server, req.params.id, extractDomain(s.page.url()), 'type', { sensitive, retry }, reply)) return
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    try {
      return await Actions.typeText(target, selector, text, delay_ms, getLogger(), s.id, purpose, inferOperator(req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // POST /api/v1/sessions/:id/press
  server.post<{
    Params: { id: string }
    Body: { selector: string; key: string; frame?: FrameSelector; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean }
  }>('/api/v1/sessions/:id/press', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { selector, key, frame, purpose, operator, sensitive, retry } = req.body
    if (!await applyPolicy(server, req.params.id, extractDomain(s.page.url()), 'press', { sensitive, retry }, reply)) return
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    try {
      return await Actions.press(target, selector, key, getLogger(), s.id, purpose, inferOperator(req, s, operator))
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
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    try {
      return await Actions.selectOption(target, selector, values, getLogger(), s.id, purpose, inferOperator(req, s, operator))
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
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    try {
      return await Actions.hover(target, selector, getLogger(), s.id, purpose, inferOperator(req, s, operator))
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
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    try {
      return await Actions.waitForSelector(target, selector, state, timeout_ms, getLogger(), s.id, purpose, inferOperator(req, s, operator))
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
      return await Actions.waitForUrl(s.page, url_pattern, timeout_ms, getLogger(), s.id, purpose, inferOperator(req, s, operator))
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
      return await Actions.waitForResponse(s.page, url_pattern, timeout_ms, triggerArg, getLogger(), s.id, purpose, inferOperator(req, s, operator))
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
      return await Actions.uploadFile(s.page, selector, content, filename, mime_type, getLogger(), s.id, purpose, inferOperator(req, s, operator))
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
      return await Actions.downloadFile(s.page, selector, timeout_ms, max_bytes, getLogger(), s.id, purpose, inferOperator(req, s, operator))
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
