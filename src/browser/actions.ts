import crypto from 'crypto'
import fs from 'fs'
import { Page, Frame } from 'playwright-core'
import { AuditLogger } from '../audit/logger'

/** Page or frame — both expose the same action surface */
export type Actionable = Page | Frame

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

async function collectDiagnostics(page: Actionable, t0: number, err: unknown): Promise<ActionDiagnostics> {
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
  page: Actionable,
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
  page: Actionable,
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
  page: Actionable,
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
  page: Actionable,
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

// ---------------------------------------------------------------------------
// R05 actions
// ---------------------------------------------------------------------------

export async function typeText(
  page: Actionable,
  selector: string,
  text: string,
  delayMs = 0,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    await page.locator(selector).pressSequentially(text, { delay: delayMs })
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'type', url: page.url(), selector, params: { delay_ms: delayMs }, result, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

export async function press(
  page: Actionable,
  selector: string,
  key: string,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; key: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    await page.press(selector, key)
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, key, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'press', url: page.url(), selector, params: { key }, result, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

export async function selectOption(
  page: Actionable,
  selector: string,
  values: string[],
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; selected: string[]; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    const selected = await page.selectOption(selector, values)
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, selected, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'select', url: page.url(), selector, params: { values }, result, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

export async function hover(
  page: Actionable,
  selector: string,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    await page.hover(selector)
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'hover', url: page.url(), selector, params: {}, result, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

export async function waitForSelector(
  page: Actionable,
  selector: string,
  state: 'attached' | 'detached' | 'visible' | 'hidden' = 'visible',
  timeoutMs = 5000,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; state: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    await page.waitForSelector(selector, { state, timeout: timeoutMs })
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, state, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'wait_for_selector', url: page.url(), selector, params: { state, timeout_ms: timeoutMs }, result, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

export async function waitForUrl(
  page: Page,
  urlPattern: string,
  timeoutMs = 5000,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; url: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    await page.waitForURL(urlPattern, { timeout: timeoutMs })
    const duration_ms = Date.now() - t0
    const url = page.url()
    const result = { status: 'ok', url, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'wait_for_url', url, params: { pattern: urlPattern, timeout_ms: timeoutMs }, result, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

export interface WaitForResponseTrigger {
  type: 'navigate'
  url: string
  waitUntil?: 'load' | 'networkidle' | 'commit' | 'domcontentloaded'
}

export async function waitForResponse(
  page: Page,
  urlPattern: string,
  timeoutMs = 10000,
  trigger?: WaitForResponseTrigger,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; url: string; status_code: number; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes(urlPattern),
      { timeout: timeoutMs },
    )
    if (trigger?.type === 'navigate') {
      await page.goto(trigger.url, { waitUntil: trigger.waitUntil ?? 'commit' })
    }
    const response = await responsePromise
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', url: response.url(), status_code: response.status(), duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'wait_for_response', url: page.url(), params: { url_pattern: urlPattern }, result, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

export async function uploadFile(
  page: Page,
  selector: string,
  fileContent: string,
  filename: string,
  mimeType = 'application/octet-stream',
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; filename: string; size_bytes: number; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    const buffer = Buffer.from(fileContent, 'base64')
    await page.setInputFiles(selector, { name: filename, mimeType, buffer })
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, filename, size_bytes: buffer.length, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'upload', url: page.url(), selector, params: { filename, mime_type: mimeType, size_bytes: buffer.length }, result, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

export async function downloadFile(
  page: Page,
  selector: string,
  timeoutMs = 30000,
  maxBytes = 50 * 1024 * 1024,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; filename: string; data: string; size_bytes: number; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: timeoutMs }),
      page.click(selector),
    ])
    const downloadPath = await download.path()
    if (!downloadPath) throw new Error('Download failed: no path returned')
    const stat = fs.statSync(downloadPath)
    if (stat.size > maxBytes) {
      throw new Error(`Download too large: ${stat.size} bytes exceeds limit of ${maxBytes} bytes`)
    }
    const buffer = fs.readFileSync(downloadPath)
    const filename = download.suggestedFilename()
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', filename, data: buffer.toString('base64'), size_bytes: buffer.length, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'download', url: page.url(), selector, params: { timeout_ms: timeoutMs }, result: { status: 'ok', filename, size_bytes: buffer.length, duration_ms }, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}
