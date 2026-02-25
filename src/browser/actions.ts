import crypto from 'crypto'
import { Page } from 'playwright-core'
import { AuditLogger } from '../audit/logger'

type WaitUntil = 'load' | 'networkidle' | 'commit' | 'domcontentloaded'

function actionId(): string {
  return 'act_' + crypto.randomBytes(6).toString('hex')
}

export async function navigate(
  page: Page,
  url: string,
  waitUntil: WaitUntil = 'load',
  logger?: AuditLogger,
  sessionId?: string,
): Promise<{ status: string; url: string; title: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  await page.goto(url, { waitUntil })
  const duration_ms = Date.now() - t0
  const title = await page.title()
  const result = { status: 'ok', url, title, duration_ms }
  logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'navigate', url, params: { wait_until: waitUntil }, result })
  return result
}

export async function click(
  page: Page,
  selector: string,
  timeoutMs = 5000,
  logger?: AuditLogger,
  sessionId?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  await page.click(selector, { timeout: timeoutMs })
  const duration_ms = Date.now() - t0
  const result = { status: 'ok', selector, duration_ms }
  logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'click', url: page.url(), selector, params: { timeout_ms: timeoutMs }, result })
  return result
}

export async function fill(
  page: Page,
  selector: string,
  value: string,
  logger?: AuditLogger,
  sessionId?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  await page.fill(selector, value)
  const duration_ms = Date.now() - t0
  const result = { status: 'ok', selector, duration_ms }
  // value is intentionally omitted from audit to avoid leaking secrets
  logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'fill', url: page.url(), selector, params: { value: '[REDACTED]' }, result })
  return result
}

export async function evaluate(
  page: Page,
  expression: string,
  logger?: AuditLogger,
  sessionId?: string,
): Promise<{ status: string; result: unknown; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  const evalResult = await page.evaluate(expression)
  const duration_ms = Date.now() - t0
  const result = { status: 'ok', result: evalResult, duration_ms }
  logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'eval', url: page.url(), params: { expression }, result: { status: 'ok', duration_ms } })
  return result
}

export async function screenshot(
  page: Page,
  format: 'png' | 'jpeg' = 'png',
  fullPage = false,
  logger?: AuditLogger,
  sessionId?: string,
): Promise<{ status: string; data: string; format: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  const buffer = await page.screenshot({ type: format, fullPage })
  const duration_ms = Date.now() - t0
  const data = buffer.toString('base64')
  const result = { status: 'ok', data, format, duration_ms }
  logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'screenshot', url: page.url(), params: { format, full_page: fullPage }, result: { status: 'ok', size_bytes: buffer.length, duration_ms } })
  return result
}
