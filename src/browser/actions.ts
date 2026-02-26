import crypto from 'crypto'
import { Page } from 'playwright-core'
import { AuditLogger } from '../audit/logger'

type WaitUntil = 'load' | 'networkidle' | 'commit' | 'domcontentloaded'

// ---------------------------------------------------------------------------
// Structured diagnostics for action failures
// ---------------------------------------------------------------------------

export interface ActionDiagnostics {
  error: string
  url: string
  title: string
  readyState: string
  elapsedMs: number
  stack?: string
}

export class ActionDiagnosticsError extends Error {
  readonly diagnostics: ActionDiagnostics
  constructor(diagnostics: ActionDiagnostics) {
    super(diagnostics.error)
    this.name = 'ActionDiagnosticsError'
    this.diagnostics = diagnostics
  }
}

async function collectDiagnostics(page: Page, t0: number, err: unknown): Promise<ActionDiagnostics> {
  const e = err instanceof Error ? err : new Error(String(err))
  const elapsedMs = Date.now() - t0
  const url = page.url()
  let title = ''
  let readyState = ''
  try { title = await page.title() } catch { /* ignore */ }
  try { readyState = await page.evaluate('document.readyState') as string } catch { /* ignore */ }
  return { error: e.message, url, title, readyState, elapsedMs, stack: e.stack }
}

function actionId(): string {
  return 'act_' + crypto.randomBytes(6).toString('hex')
}

export async function navigate(
  page: Page,
  url: string,
  waitUntil: WaitUntil = 'load',
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; url: string; title: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  await page.goto(url, { waitUntil })
  const duration_ms = Date.now() - t0
  const title = await page.title()
  const result = { status: 'ok', url, title, duration_ms }
  logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'navigate', url, params: { wait_until: waitUntil }, result, purpose, operator })
  return result
}

export async function click(
  page: Page,
  selector: string,
  timeoutMs = 5000,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  await page.click(selector, { timeout: timeoutMs })
  const duration_ms = Date.now() - t0
  const result = { status: 'ok', selector, duration_ms }
  logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'click', url: page.url(), selector, params: { timeout_ms: timeoutMs }, result, purpose, operator })
  return result
}

export async function fill(
  page: Page,
  selector: string,
  value: string,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  await page.fill(selector, value)
  const duration_ms = Date.now() - t0
  const result = { status: 'ok', selector, duration_ms }
  // value is intentionally omitted from audit to avoid leaking secrets
  logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'fill', url: page.url(), selector, params: { value: '[REDACTED]' }, result, purpose, operator })
  return result
}

export async function evaluate(
  page: Page,
  expression: string,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; result: unknown; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    const evalResult = await page.evaluate(expression)
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', result: evalResult, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'eval', url: page.url(), params: { expression }, result: { status: 'ok', duration_ms }, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

export async function extract(
  page: Page,
  selector: string,
  attribute?: string,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; items: Array<Record<string, string | null>>; count: number; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
  // Use $$eval to safely extract text/attribute without arbitrary JS
  const items = await page.$$eval(
    selector,
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (els: any[], attr: any) =>
      els.map((el: any) => {
        const text: string = el.innerText ?? el.textContent ?? ''
        const result: Record<string, string | null> = { text: text.trim() }
        if (attr) result[attr] = el.getAttribute(attr) as string | null
        return result
      }),
    attribute ?? null,
  )

    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, items, count: items.length, duration_ms }
    logger?.write({
      session_id: sessionId,
      action_id: id,
      type: 'action',
      action: 'extract',
      url: page.url(),
      selector,
      params: { attribute: attribute ?? null },
      result: { status: 'ok', count: items.length, duration_ms },
      purpose,
      operator,
    })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

export async function screenshot(
  page: Page,
  format: 'png' | 'jpeg' = 'png',
  fullPage = false,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; data: string; format: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    const buffer = await page.screenshot({ type: format, fullPage })
    const duration_ms = Date.now() - t0
    const data = buffer.toString('base64')
    const result = { status: 'ok', data, format, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'screenshot', url: page.url(), params: { format, full_page: fullPage }, result: { status: 'ok', size_bytes: buffer.length, duration_ms }, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}
