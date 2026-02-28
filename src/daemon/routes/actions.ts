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
import { BrowserManager } from '../../browser/manager'

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
// R07-T01/T14: element_id / ref_id → CSS selector resolver
// Built as a factory inside registerActionRoutes to access BrowserManager.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// R08-R09: Preflight parameter validation helpers
// ---------------------------------------------------------------------------

/** Violation descriptor sent back as structured 400 on preflight failure. */
type PFViolation = { field: string; constraint: string; value: unknown }

function pfRange(field: string, value: number | undefined, min: number, max: number): PFViolation | null {
  if (value === undefined) return null
  return value < min || value > max ? { field, constraint: `must be ${min}–${max}`, value } : null
}

function pfMaxLen(field: string, value: string | undefined, max: number): PFViolation | null {
  if (!value) return null
  return value.length > max ? { field, constraint: `max length ${max} chars`, value: value.length } : null
}

/** Run an ordered list of checks; sends 400 + returns false on first violation. */
function preflight(checks: Array<PFViolation | null>, reply: FastifyReply): boolean {
  const v = checks.find(Boolean) as PFViolation | undefined
  if (v) { reply.code(400).send({ error: 'preflight_failed', field: v.field, constraint: v.constraint, value: v.value }); return false }
  return true
}

// ---------------------------------------------------------------------------
// R08-R02: Stability strategy middleware
// ---------------------------------------------------------------------------

interface StabilityOpts { wait_before_ms?: number; wait_after_ms?: number; wait_dom_stable_ms?: number }

async function applyStabilityPre(page: Page, opts?: StabilityOpts): Promise<void> {
  if (!opts) return
  if (opts.wait_before_ms) await new Promise<void>(r => setTimeout(r, opts.wait_before_ms!))
  if (opts.wait_dom_stable_ms) {
    try { await page.waitForFunction('document.readyState === "complete"', undefined, { timeout: opts.wait_dom_stable_ms }) } catch { /* timeout is acceptable */ }
  }
}

async function applyStabilityPost(page: Page, opts?: StabilityOpts): Promise<void> {
  if (!opts) return
  if (opts.wait_after_ms) await new Promise<void>(r => setTimeout(r, opts.wait_after_ms!))
}

export function registerActionRoutes(server: FastifyInstance, registry: SessionRegistry): void {
  function getLogger(): AuditLogger | undefined {
    return server.auditLogger
  }

  /**
   * R07-T14: Resolve an action target (selector | element_id | ref_id) to CSS selector.
   * ref_id: validates snapshot exists + page_rev matches (→ 409 stale_ref on mismatch).
   * element_id: injected DOM attribute selector.
   * selector: passed through as-is.
   */
  function resolveTarget(
    input: { selector?: string; element_id?: string; ref_id?: string },
    reply: FastifyReply,
    sessionId?: string,
  ): string | null {
    if (input.ref_id) {
      const bm: BrowserManager | undefined = (server as any).browserManager
      if (!bm || !sessionId) {
        reply.code(500).send({ error: 'ref_id resolution requires BrowserManager' })
        return null
      }
      const colonIdx = input.ref_id.lastIndexOf(':')
      if (colonIdx === -1) {
        reply.code(400).send({ error: 'Invalid ref_id format; expected "snap_XXXXXX:eN"' })
        return null
      }
      const snapshotId = input.ref_id.slice(0, colonIdx)
      const eid = input.ref_id.slice(colonIdx + 1)
      const snapshot = bm.getSnapshot(sessionId, snapshotId)
      if (!snapshot) {
        reply.code(409).send({
          error: 'stale_ref', ref_id: input.ref_id,
          message: 'Snapshot not found or expired; call snapshot_map again',
          suggestions: ['call snapshot_map to get fresh ref_ids', 'use selector or element_id as fallback'],
        })
        return null
      }
      const currentRev = bm.getPageRev(sessionId)
      if (snapshot.page_rev !== currentRev) {
        reply.code(409).send({
          error: 'stale_ref',
          ref_id: input.ref_id,
          snapshot_page_rev: snapshot.page_rev,
          current_page_rev: currentRev,
          message: 'Page has changed since snapshot was taken; call snapshot_map again',
          suggestions: ['call snapshot_map to get fresh ref_ids', 'if page is stable, the navigation event incremented page_rev — wait and resnapshot'],
        })
        return null
      }
      return `[data-agentmb-eid="${eid}"]`
    }
    if (input.element_id) return `[data-agentmb-eid="${input.element_id}"]`
    if (input.selector) return input.selector
    reply.code(400).send({ error: 'Either selector, element_id, or ref_id is required' })
    return null
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
  // R08-R06: executor='auto_fallback' automatically retries via bbox coords on DOM failure
  // R08-R02: stability.wait_before_ms / wait_after_ms / wait_dom_stable_ms
  // R08-R09: preflight validates timeout_ms range
  server.post<{
    Params: { id: string }
    Body: {
      selector?: string; element_id?: string; ref_id?: string; timeout_ms?: number
      frame?: FrameSelector; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean
      fallback_x?: number; fallback_y?: number
      executor?: 'strict' | 'auto_fallback'
      stability?: StabilityOpts
    }
  }>('/api/v1/sessions/:id/click', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { timeout_ms = 5000, frame, purpose, operator, sensitive, retry, fallback_x, fallback_y, executor = 'strict', stability } = req.body
    if (!preflight([pfRange('timeout_ms', timeout_ms, 50, 60000)], reply)) return
    const selector = resolveTarget(req.body, reply, s.id)
    if (!selector) return
    if (!await applyPolicy(server, req.params.id, extractDomain(s.page.url()), 'click', { sensitive, retry }, reply)) return
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    await applyStabilityPre(s.page, stability)
    try {
      const result = await Actions.click(target, selector, timeout_ms, getLogger(), s.id, purpose, inferOperator(req, s, operator))
      await applyStabilityPost(s.page, stability)
      return { ...result, executed_via: 'high_level' }
    } catch (domErr) {
      // auto_fallback: resolve element bbox and retry via mouse.click()
      if (executor === 'auto_fallback') {
        try {
          const bbox = await target.locator(selector).boundingBox()
          if (bbox) {
            const cx = Math.round(bbox.x + bbox.width / 2)
            const cy = Math.round(bbox.y + bbox.height / 2)
            await s.page.mouse.click(cx, cy)
            await applyStabilityPost(s.page, stability)
            return { status: 'ok', selector, executed_via: 'low_level', fallback_x: cx, fallback_y: cy, duration_ms: 0 }
          }
        } catch { /* fallback also failed — fall through to original error */ }
      }
      // explicit fallback coordinates (legacy T21 path)
      if (fallback_x !== undefined && fallback_y !== undefined) {
        try {
          await s.page.mouse.click(fallback_x, fallback_y)
          return { status: 'ok', selector, executed_via: 'low_level', track: 'coords', fallback_x, fallback_y, duration_ms: 0 }
        } catch { /* both tracks failed */ }
      }
      if (domErr instanceof Actions.ActionDiagnosticsError) {
        const diag = { ...domErr.diagnostics, suggested_fallback: 'retry with executor="auto_fallback" to attempt coordinates-based click' }
        return reply.code(422).send(diag)
      }
      throw domErr
    }
  })

  // POST /api/v1/sessions/:id/fill
  // R08-R02: stability options; R08-R09: preflight value length
  server.post<{
    Params: { id: string }
    Body: { selector?: string; element_id?: string; ref_id?: string; value: string; frame?: FrameSelector; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean; stability?: StabilityOpts }
  }>('/api/v1/sessions/:id/fill', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { value, frame, purpose, operator, sensitive, retry, stability } = req.body
    if (!preflight([pfMaxLen('value', value, 100_000)], reply)) return
    const selector = resolveTarget(req.body, reply, s.id)
    if (!selector) return
    if (!await applyPolicy(server, req.params.id, extractDomain(s.page.url()), 'fill', { sensitive, retry }, reply)) return
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    await applyStabilityPre(s.page, stability)
    const result = await Actions.fill(target, selector, value, getLogger(), s.id, purpose, inferOperator(req, s, operator))
    await applyStabilityPost(s.page, stability)
    return result
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
    Body: { selector?: string; element_id?: string; ref_id?: string; text: string; delay_ms?: number; frame?: FrameSelector; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean }
  }>('/api/v1/sessions/:id/type', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { text, delay_ms = 0, frame, purpose, operator, sensitive, retry } = req.body
    const selector = resolveTarget(req.body, reply, s.id)
    if (!selector) return
    // shadow 'selector' is now resolved; keep original destructure pattern below
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
    Body: { selector?: string; element_id?: string; ref_id?: string; key: string; frame?: FrameSelector; purpose?: string; operator?: string; sensitive?: boolean; retry?: boolean }
  }>('/api/v1/sessions/:id/press', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { key, frame, purpose, operator, sensitive, retry } = req.body
    const selector = resolveTarget(req.body, reply, s.id)
    if (!selector) return
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
    Body: { selector?: string; element_id?: string; ref_id?: string; frame?: FrameSelector; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/hover', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { frame, purpose, operator } = req.body
    const selector = resolveTarget(req.body, reply, s.id)
    if (!selector) return
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
  // T07: guard on accept_downloads; T08: element_id / ref_id support
  server.post<{
    Params: { id: string }
    Body: { selector?: string; element_id?: string; ref_id?: string; timeout_ms?: number; max_bytes?: number; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/download', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    // T07: check accept_downloads is enabled
    const bm = server.browserManager
    if (bm && !bm.getAcceptDownloads(s.id)) {
      return reply.code(422).send({
        error: 'download_not_enabled',
        message: 'Downloads are disabled for this session. Create the session with accept_downloads=true (CLI: agentmb session new --accept-downloads).',
      })
    }
    const { timeout_ms = 30000, max_bytes = 50 * 1024 * 1024, purpose, operator } = req.body
    // T08: resolve selector/element_id/ref_id to CSS selector
    const selector = resolveTarget(req.body, reply, s.id)
    if (!selector) return
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

  // ---------------------------------------------------------------------------
  // R07-T01: element_map — scan page, assign stable element IDs
  // ---------------------------------------------------------------------------

  server.post<{
    Params: { id: string }
    Body: { scope?: string; limit?: number; include_unlabeled?: boolean; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/element_map', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { scope, limit = 500, include_unlabeled = false, purpose, operator } = req.body ?? {}
    try {
      return await Actions.elementMap(s.page, { scope, limit, include_unlabeled }, getLogger(), s.id, purpose, inferOperator(req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // ---------------------------------------------------------------------------
  // R07-T02: get — read a property from a page element
  // ---------------------------------------------------------------------------

  server.post<{
    Params: { id: string }
    Body: {
      selector?: string
      element_id?: string
      ref_id?: string
      property: 'text' | 'html' | 'value' | 'attr' | 'count' | 'box'
      attr_name?: string
      frame?: FrameSelector
      purpose?: string
      operator?: string
    }
  }>('/api/v1/sessions/:id/get', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { property, attr_name, frame, purpose, operator } = req.body
    if (!property) return reply.code(400).send({ error: 'property is required (text|html|value|attr|count|box)' })
    const selector = resolveTarget(req.body, reply, s.id)
    if (!selector) return
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    try {
      return await Actions.getProperty(target, selector, property, attr_name, getLogger(), s.id, purpose, inferOperator(req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // ---------------------------------------------------------------------------
  // R07-T02: assert — check element state
  // ---------------------------------------------------------------------------

  server.post<{
    Params: { id: string }
    Body: {
      selector?: string
      element_id?: string
      ref_id?: string
      property: 'visible' | 'enabled' | 'checked'
      expected?: boolean
      frame?: FrameSelector
      purpose?: string
      operator?: string
    }
  }>('/api/v1/sessions/:id/assert', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { property, expected = true, frame, purpose, operator } = req.body
    if (!property) return reply.code(400).send({ error: 'property is required (visible|enabled|checked)' })
    const selector = resolveTarget(req.body, reply, s.id)
    if (!selector) return
    const target = resolveOrReply(s.page, frame, reply)
    if (!target) return
    try {
      return await Actions.assertState(target, selector, property, expected, getLogger(), s.id, purpose, inferOperator(req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // ---------------------------------------------------------------------------
  // R07-T07: wait_page_stable — network idle + DOM quiescence + overlay check
  // ---------------------------------------------------------------------------

  server.post<{
    Params: { id: string }
    Body: { timeout_ms?: number; dom_stable_ms?: number; overlay_selector?: string; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/wait_page_stable', async (req, reply) => {
    const s = resolve(req.params.id, reply)
    if (!s) return
    const { timeout_ms = 10000, dom_stable_ms = 300, overlay_selector, purpose, operator } = req.body ?? {}
    try {
      return await Actions.waitPageStable(s.page, { timeout_ms, dom_stable_ms, overlay_selector }, getLogger(), s.id, purpose, inferOperator(req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // ---------------------------------------------------------------------------
  // R07-T03: Interaction primitives
  // ---------------------------------------------------------------------------

  server.post<{ Params: { id: string }; Body: { selector?: string; element_id?: string; ref_id?: string; timeout_ms?: number; frame?: FrameSelector; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/dblclick', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const selector = resolveTarget(req.body, reply, s.id); if (!selector) return
    const target = resolveOrReply(s.page, req.body.frame, reply); if (!target) return
    try { return await Actions.dblclick(target, selector, req.body.timeout_ms ?? 5000, getLogger(), s.id, req.body.purpose, inferOperator(req, s, req.body.operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { selector?: string; element_id?: string; ref_id?: string; frame?: FrameSelector; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/focus', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const selector = resolveTarget(req.body, reply, s.id); if (!selector) return
    const target = resolveOrReply(s.page, req.body.frame, reply); if (!target) return
    try { return await Actions.focus(target, selector, getLogger(), s.id, req.body.purpose, inferOperator(req, s, req.body.operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { selector?: string; element_id?: string; ref_id?: string; timeout_ms?: number; frame?: FrameSelector; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/check', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const selector = resolveTarget(req.body, reply, s.id); if (!selector) return
    const target = resolveOrReply(s.page, req.body.frame, reply); if (!target) return
    try { return await Actions.check(target, selector, req.body.timeout_ms ?? 5000, getLogger(), s.id, req.body.purpose, inferOperator(req, s, req.body.operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { selector?: string; element_id?: string; ref_id?: string; timeout_ms?: number; frame?: FrameSelector; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/uncheck', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const selector = resolveTarget(req.body, reply, s.id); if (!selector) return
    const target = resolveOrReply(s.page, req.body.frame, reply); if (!target) return
    try { return await Actions.uncheck(target, selector, req.body.timeout_ms ?? 5000, getLogger(), s.id, req.body.purpose, inferOperator(req, s, req.body.operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { selector?: string; element_id?: string; ref_id?: string; delta_x?: number; delta_y?: number; frame?: FrameSelector; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/scroll', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const selector = resolveTarget(req.body, reply, s.id); if (!selector) return
    const target = resolveOrReply(s.page, req.body.frame, reply); if (!target) return
    const { delta_x = 0, delta_y = 300, purpose, operator } = req.body
    try { return await Actions.scroll(target, selector, { delta_x, delta_y }, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { selector?: string; element_id?: string; ref_id?: string; frame?: FrameSelector; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/scroll_into_view', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const selector = resolveTarget(req.body, reply, s.id); if (!selector) return
    const target = resolveOrReply(s.page, req.body.frame, reply); if (!target) return
    try { return await Actions.scrollIntoView(target, selector, getLogger(), s.id, req.body.purpose, inferOperator(req, s, req.body.operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { source?: string; source_element_id?: string; source_ref_id?: string; target?: string; target_element_id?: string; target_ref_id?: string; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/drag', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { source, source_element_id, source_ref_id, target, target_element_id, target_ref_id, purpose, operator } = req.body
    const src = resolveTarget({ selector: source, element_id: source_element_id, ref_id: source_ref_id }, reply, s.id)
    if (!src) return
    const tgt = resolveTarget({ selector: target, element_id: target_element_id, ref_id: target_ref_id }, reply, s.id)
    if (!tgt) return
    try { return await Actions.drag(s.page, src, tgt, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  // R08-R05: Ref->Box->Input — mouse_move accepts ref_id and resolves to bbox center
  server.post<{ Params: { id: string }; Body: { x?: number; y?: number; ref_id?: string; element_id?: string; selector?: string; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/mouse_move', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { purpose, operator } = req.body
    let { x, y } = req.body
    // Ref->Box->Input: if ref_id/element_id/selector provided, resolve to bbox center coords
    if (req.body.ref_id || req.body.element_id || req.body.selector) {
      const cssSelector = resolveTarget(req.body, reply, s.id)
      if (!cssSelector) return
      const bbox = await s.page.locator(cssSelector).boundingBox()
      if (!bbox) return reply.code(404).send({ error: 'Element not found or not visible for mouse_move', selector: cssSelector })
      x = Math.round(bbox.x + bbox.width / 2)
      y = Math.round(bbox.y + bbox.height / 2)
    }
    if (x === undefined || y === undefined) return reply.code(400).send({ error: 'Either x+y coordinates or ref_id/element_id/selector is required' })
    try { return await Actions.mouseMove(s.page, x, y, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { x?: number; y?: number; button?: 'left' | 'right' | 'middle'; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/mouse_down', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { x, y, button = 'left', purpose, operator } = req.body
    try { return await Actions.mouseDown(s.page, { x, y, button }, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { button?: 'left' | 'right' | 'middle'; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/mouse_up', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { button = 'left', purpose, operator } = req.body
    try { return await Actions.mouseUp(s.page, button, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { key: string; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/key_down', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { key, purpose, operator } = req.body
    try { return await Actions.keyDown(s.page, key, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { key: string; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/key_up', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { key, purpose, operator } = req.body
    try { return await Actions.keyUp(s.page, key, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  // ---------------------------------------------------------------------------
  // R07-T04: Wait / navigation control
  // ---------------------------------------------------------------------------

  server.post<{ Params: { id: string }; Body: { timeout_ms?: number; wait_until?: string; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/back', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { timeout_ms = 5000, wait_until = 'load', purpose, operator } = req.body ?? {}
    try { return await Actions.back(s.page, timeout_ms, wait_until as any, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { timeout_ms?: number; wait_until?: string; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/forward', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { timeout_ms = 5000, wait_until = 'load', purpose, operator } = req.body ?? {}
    try { return await Actions.forward(s.page, timeout_ms, wait_until as any, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { timeout_ms?: number; wait_until?: string; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/reload', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { timeout_ms = 10000, wait_until = 'load', purpose, operator } = req.body ?? {}
    try { return await Actions.reload(s.page, timeout_ms, wait_until as any, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { text: string; timeout_ms?: number; frame?: FrameSelector; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/wait_text', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { text, timeout_ms = 5000, frame, purpose, operator } = req.body
    const target = resolveOrReply(s.page, frame, reply); if (!target) return
    try { return await Actions.waitForText(target, text, timeout_ms, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { state?: string; timeout_ms?: number; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/wait_load_state', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { state = 'load', timeout_ms = 10000, purpose, operator } = req.body ?? {}
    try { return await Actions.waitForLoadState(s.page, state as any, timeout_ms, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{ Params: { id: string }; Body: { expression: string; timeout_ms?: number; purpose?: string; operator?: string } }>('/api/v1/sessions/:id/wait_function', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { expression, timeout_ms = 5000, purpose, operator } = req.body
    try { return await Actions.waitForFunction(s.page, expression, timeout_ms, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  // ---------------------------------------------------------------------------
  // R07-T08: Generic scroll primitives
  // ---------------------------------------------------------------------------

  server.post<{
    Params: { id: string }
    Body: { direction?: string; scroll_selector?: string; stop_selector?: string; stop_text?: string; max_scrolls?: number; scroll_delta?: number; stall_ms?: number; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/scroll_until', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { purpose, operator, ...opts } = req.body ?? {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { return await Actions.scrollUntil(s.page, opts as any, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  server.post<{
    Params: { id: string }
    Body: { load_more_selector: string; content_selector: string; item_count?: number; stop_text?: string; max_loads?: number; stall_ms?: number; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/load_more_until', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { purpose, operator, ...opts } = req.body
    try { return await Actions.loadMoreUntil(s.page, opts, getLogger(), s.id, purpose, inferOperator(req, s, operator)) }
    catch (e) { if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics); throw e }
  })

  // ---------------------------------------------------------------------------
  // R07-T13: snapshot_map — versioned element scan with page_rev tracking
  // ---------------------------------------------------------------------------

  server.post<{
    Params: { id: string }
    Body: { scope?: string; limit?: number; include_unlabeled?: boolean; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/snapshot_map', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const { scope, limit = 500, include_unlabeled = false, purpose, operator } = req.body ?? {}
    const bm: BrowserManager | undefined = (server as any).browserManager
    try {
      const elemResult = await Actions.elementMap(s.page, { scope, limit, include_unlabeled }, getLogger(), s.id, purpose, inferOperator(req, s, operator))
      const snapshotId = 'snap_' + crypto.randomBytes(4).toString('hex')
      const pageRev = bm?.getPageRev(s.id) ?? 0
      const elements = elemResult.elements.map((el: any) => ({ ...el, ref_id: `${snapshotId}:${el.element_id}` }))
      bm?.storeSnapshot(s.id, { snapshot_id: snapshotId, page_rev: pageRev, url: s.page.url(), elements, created_at: Date.now() })
      return { status: 'ok', snapshot_id: snapshotId, page_rev: pageRev, url: s.page.url(), elements, count: elements.length, duration_ms: elemResult.duration_ms }
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // ---------------------------------------------------------------------------
  // R08-R12: Snapshot Ref 强化 — GET page_rev endpoint
  // Lets clients cheaply check if the page has changed since last snapshot.
  // ---------------------------------------------------------------------------
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/page_rev', async (req, reply) => {
    const s = resolve(req.params.id, reply); if (!s) return
    const bm: BrowserManager | undefined = (server as any).browserManager
    const page_rev = bm?.getPageRev(s.id) ?? 0
    return { status: 'ok', session_id: req.params.id, page_rev, url: s.page.url() }
  })
}
