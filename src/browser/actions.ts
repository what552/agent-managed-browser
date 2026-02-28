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
  try {
    await page.click(selector, { timeout: timeoutMs })
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'click', url: page.url(), selector, params: { timeout_ms: timeoutMs }, result, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
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
// R07-T15: Annotated screenshot — highlights elements with CSS overlays
// ---------------------------------------------------------------------------

export interface HighlightSpec {
  selector: string
  color?: string   // CSS color string, default 'rgba(255,80,80,0.35)'
  label?: string   // optional text label drawn on overlay
}

export async function annotatedScreenshot(
  page: Page,
  highlights: HighlightSpec[],
  format: 'png' | 'jpeg' = 'png',
  fullPage = false,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; data: string; format: string; highlight_count: number; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  const STYLE_ID = '__agentmb_hl__'
  try {
    // Build and inject highlight CSS
    const rules = highlights.map(({ selector, color = 'rgba(255,80,80,0.35)', label }) => {
      // Sanitize color: strip characters that could break out of a CSS value
      // (curly braces, semicolons, CSS comment markers).
      const safeColor = color.replace(/[{};]|\/\*|\*\//g, '')
      // Escape label for use inside a single-quoted CSS content string:
      // backslash must be escaped first, then quote, then control chars.
      const safeLabel = label
        ? label
            .replace(/\\/g, '\\\\')   // backslash → \\
            .replace(/'/g, "\\'")     // single-quote → \'
            .replace(/\n/g, '\\A ')   // newline → CSS unicode escape
            .replace(/\r/g, '')       // carriage return → strip
        : ''
      return [
        `${selector} { outline: 3px solid ${safeColor} !important; background-color: ${safeColor} !important; position: relative !important; }`,
        safeLabel
          ? `${selector}::before { content: '${safeLabel}'; position: absolute; top: 0; left: 0; background: ${safeColor}; color: #000; font-size: 11px; padding: 1px 3px; z-index: 99999; pointer-events: none; }`
          : '',
      ].join('\n')
    }).join('\n')

    await page.evaluate(({ styleId, css }: { styleId: string; css: string }) => {
      const el = (globalThis as any).document.createElement('style')
      el.id = styleId
      el.textContent = css
      ;(globalThis as any).document.head.appendChild(el)
    }, { styleId: STYLE_ID, css: rules })

    const buffer = await page.screenshot({ type: format, fullPage })
    const duration_ms = Date.now() - t0
    const data = buffer.toString('base64')

    // Remove injected style
    await page.evaluate((styleId: string) => {
      (globalThis as any).document.getElementById(styleId)?.remove()
    }, STYLE_ID).catch(() => { /* page may have navigated, ignore */ })

    const result = { status: 'ok', data, format, highlight_count: highlights.length, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'annotated_screenshot', url: page.url(), params: { format, full_page: fullPage, highlights: highlights.length }, result: { status: 'ok', size_bytes: buffer.length, duration_ms }, purpose, operator })
    return result
  } catch (err) {
    // Clean up injected style on error too
    await page.evaluate((styleId: string) => {
      (globalThis as any).document.getElementById(styleId)?.remove()
    }, STYLE_ID).catch(() => { /* ignore */ })
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
): Promise<{ status: string; selector: string; filename: string; size_bytes: number; mime_type: string; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    const buffer = Buffer.from(fileContent, 'base64')
    await page.setInputFiles(selector, { name: filename, mimeType, buffer })
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, filename, size_bytes: buffer.length, mime_type: mimeType, duration_ms }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'upload', url: page.url(), selector, params: { filename, mime_type: mimeType, size_bytes: buffer.length }, result, purpose, operator })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

// ---------------------------------------------------------------------------
// R07-T01: element_map — scan page elements, assign stable IDs
// ---------------------------------------------------------------------------

export interface ElementInfo {
  element_id: string
  tag: string
  role: string
  text: string
  name: string
  placeholder: string
  href: string
  type: string
  overlay_blocked: boolean
  rect: { x: number; y: number; width: number; height: number }
  /** Synthesized human-readable label (T03). Source priority: aria-label > title > aria-labelledby > svg-title > text > placeholder */
  label: string
  /** Which source produced label: 'aria-label'|'title'|'aria-labelledby'|'svg-title'|'text'|'placeholder'|'fallback'|'none' */
  label_source: string
}

/**
 * Scan the page for interactive/visible elements, inject `data-agentmb-eid`
 * attributes for stable re-targeting, and return an ordered map.
 * Subsequent actions may use element_id instead of a CSS selector.
 */
export async function elementMap(
  page: Page,
  opts: { scope?: string; limit?: number; include_unlabeled?: boolean } = {},
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; url: string; elements: ElementInfo[]; count: number; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    const { scope, limit = 500, include_unlabeled = false } = opts
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const elements = await page.evaluate(
      ([scopeSelector, maxElements, includeUnlabeled]: [string | undefined, number, boolean]) => {
        const doc: any = (globalThis as any).document
        const win: any = (globalThis as any).window
        const root: any = scopeSelector ? (doc.querySelector(scopeSelector) ?? doc.body) : doc.body

        // Remove previous scan IDs
        root.querySelectorAll('[data-agentmb-eid]').forEach((el: any) => el.removeAttribute('data-agentmb-eid'))

        const SELECTORS = [
          'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
          '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
          '[role="menuitem"]', '[role="tab"]', '[role="option"]', '[role="combobox"]',
          '[role="switch"]', '[role="spinbutton"]', '[role="slider"]',
          '[tabindex]:not([tabindex="-1"])', 'label[for]',
        ].join(',')

        /** T03: synthesize a human-readable label with source priority chain */
        function synthesizeLabel(el: any, cx: number, cy: number): { label: string; label_source: string } {
          // 1. aria-label attribute
          const ariaLabel = (el.getAttribute('aria-label') ?? '').trim()
          if (ariaLabel) return { label: ariaLabel, label_source: 'aria-label' }

          // 2. title attribute
          const title = (el.getAttribute('title') ?? '').trim()
          if (title) return { label: title, label_source: 'title' }

          // 3. aria-labelledby — collect referenced element text
          const labelledBy = el.getAttribute('aria-labelledby') ?? ''
          if (labelledBy) {
            const parts = labelledBy.split(/\s+/).map((lid: string) => {
              const ref = doc.getElementById(lid)
              return ref ? (ref.innerText ?? ref.textContent ?? '').trim() : ''
            }).filter(Boolean)
            if (parts.length) return { label: parts.join(' '), label_source: 'aria-labelledby' }
          }

          // 4. SVG <title> or <desc> as first child of svg descendant
          const svg = el.querySelector('svg')
          if (svg) {
            const svgTitle = svg.querySelector('title')
            const svgTitleText = svgTitle ? (svgTitle.textContent ?? '').trim() : ''
            if (svgTitleText) return { label: svgTitleText, label_source: 'svg-title' }
            const svgDesc = svg.querySelector('desc')
            const svgDescText = svgDesc ? (svgDesc.textContent ?? '').trim() : ''
            if (svgDescText) return { label: svgDescText, label_source: 'svg-title' }
          }

          // 5. visible innerText / textContent
          const innerText = (el.innerText ?? el.textContent ?? '').trim().slice(0, 200)
          if (innerText) return { label: innerText, label_source: 'text' }

          // 6. placeholder attribute
          const placeholder = (el.getAttribute('placeholder') ?? '').trim()
          if (placeholder) return { label: placeholder, label_source: 'placeholder' }

          // 7. fallback: synthesize position label (only when include_unlabeled requested)
          if (includeUnlabeled) {
            const tag = el.tagName.toLowerCase()
            return { label: `[${tag} @ ${Math.round(cx)},${Math.round(cy)}]`, label_source: 'fallback' }
          }

          return { label: '', label_source: 'none' }
        }

        const candidates: any[] = Array.from(root.querySelectorAll(SELECTORS))
        let counter = 0
        const results: any[] = []

        for (const el of candidates) {
          if (counter >= maxElements) break
          const style = win.getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue
          const rect = el.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) continue

          counter++
          const eid = `e${counter}`
          el.setAttribute('data-agentmb-eid', eid)

          const cx = rect.left + rect.width / 2
          const cy = rect.top + rect.height / 2
          const topEl: any = doc.elementFromPoint(cx, cy)
          const overlayBlocked = topEl ? (!el.contains(topEl) && !topEl.contains(el) && topEl !== el) : false

          const { label, label_source } = synthesizeLabel(el, cx, cy)

          results.push({
            element_id: eid,
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
            text: (el.innerText ?? el.textContent ?? '').trim().slice(0, 200),
            name: el.getAttribute('name') ?? el.getAttribute('aria-label') ?? '',
            placeholder: el.getAttribute('placeholder') ?? '',
            href: el.getAttribute('href') ?? '',
            type: el.getAttribute('type') ?? '',
            overlay_blocked: overlayBlocked,
            rect: {
              x: Math.round(rect.x), y: Math.round(rect.y),
              width: Math.round(rect.width), height: Math.round(rect.height),
            },
            label,
            label_source,
          })
        }
        return results
      },
      [scope, limit, include_unlabeled] as [string | undefined, number, boolean],
    ) as ElementInfo[]
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const duration_ms = Date.now() - t0
    const result = { status: 'ok', url: page.url(), elements, count: elements.length, duration_ms }
    logger?.write({
      session_id: sessionId, action_id: id, type: 'action', action: 'element_map',
      url: page.url(), params: { scope: scope ?? null, limit, include_unlabeled },
      result: { status: 'ok', count: elements.length, duration_ms }, purpose, operator,
    })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

// ---------------------------------------------------------------------------
// R07-T02: get — read a property from a page element
// ---------------------------------------------------------------------------

export type GetProperty = 'text' | 'html' | 'value' | 'attr' | 'count' | 'box'

export async function getProperty(
  page: Actionable,
  selector: string,
  property: GetProperty,
  attrName?: string,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; property: GetProperty; value: unknown; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    let value: unknown
    switch (property) {
      case 'text':
        value = await page.locator(selector).first().innerText({ timeout: 5000 })
        break
      case 'html':
        value = await page.locator(selector).first().innerHTML({ timeout: 5000 })
        break
      case 'value':
        value = await page.locator(selector).first().inputValue({ timeout: 5000 })
        break
      case 'attr':
        if (!attrName) throw new Error('attr_name is required when property=attr')
        value = await page.locator(selector).first().getAttribute(attrName, { timeout: 5000 })
        break
      case 'count':
        value = await page.locator(selector).count()
        break
      case 'box':
        value = await page.locator(selector).first().boundingBox({ timeout: 5000 })
        break
    }
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, property, value, duration_ms }
    logger?.write({
      session_id: sessionId, action_id: id, type: 'action', action: 'get',
      url: page.url(), selector, params: { property, attr_name: attrName ?? null },
      result: { status: 'ok', duration_ms }, purpose, operator,
    })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

// ---------------------------------------------------------------------------
// R07-T02: assert — check element state
// ---------------------------------------------------------------------------

export type AssertProperty = 'visible' | 'enabled' | 'checked'

export async function assertState(
  page: Actionable,
  selector: string,
  property: AssertProperty,
  expected = true,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string; property: AssertProperty; actual: boolean; expected: boolean; passed: boolean; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  try {
    let actual: boolean
    const loc = page.locator(selector).first()
    switch (property) {
      case 'visible':  actual = await loc.isVisible({ timeout: 5000 }); break
      case 'enabled':  actual = await loc.isEnabled({ timeout: 5000 }); break
      case 'checked':  actual = await loc.isChecked({ timeout: 5000 }); break
    }
    const passed = actual === expected
    const duration_ms = Date.now() - t0
    const result = { status: 'ok', selector, property, actual, expected, passed, duration_ms }
    logger?.write({
      session_id: sessionId, action_id: id, type: 'action', action: 'assert',
      url: page.url(), selector, params: { property, expected },
      result: { status: 'ok', passed, duration_ms }, purpose, operator,
    })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

// ---------------------------------------------------------------------------
// R07-T07: wait_page_stable — network idle + DOM quiescence + overlay check
// ---------------------------------------------------------------------------

export async function waitPageStable(
  page: Page,
  opts: {
    timeout_ms?: number
    dom_stable_ms?: number
    overlay_selector?: string
  } = {},
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; url: string; waited_ms: number; duration_ms: number }> {
  const id = actionId()
  const t0 = Date.now()
  const { timeout_ms = 10000, dom_stable_ms = 300, overlay_selector } = opts
  try {
    // 1. Network idle
    await page.waitForLoadState('networkidle', { timeout: timeout_ms })

    // 2. DOM mutation quiescence — MutationObserver waits for `dom_stable_ms` of silence
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await page.evaluate(
      ([stabilityMs, timeoutMs]: [number, number]) =>
        new Promise<void>((resolve, reject) => {
          const doc: any = (globalThis as any).document
          let timer: any
          const settle = () => {
            clearTimeout(timer)
            timer = setTimeout(() => {
              observer.disconnect()
              resolve()
            }, stabilityMs)
          }
          const observer: any = new (globalThis as any).MutationObserver(settle)
          observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: false })
          settle()
          setTimeout(() => {
            observer.disconnect()
            clearTimeout(timer)
            reject(new Error('DOM stability timeout'))
          }, Math.max(0, timeoutMs))
        }),
      [dom_stable_ms, Math.max(500, timeout_ms - (Date.now() - t0))] as [number, number],
    )
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // 3. Overlay check — wait until overlay_selector matches no elements
    if (overlay_selector) {
      const deadline = t0 + timeout_ms
      while (Date.now() < deadline) {
        const count = await page.locator(overlay_selector).count()
        if (count === 0) break
        await new Promise((r) => setTimeout(r, 100))
      }
      const remaining = await page.locator(overlay_selector).count()
      if (remaining > 0) {
        throw new Error(`Overlay '${overlay_selector}' still present after ${timeout_ms}ms`)
      }
    }

    const duration_ms = Date.now() - t0
    const result = { status: 'ok', url: page.url(), waited_ms: duration_ms, duration_ms }
    logger?.write({
      session_id: sessionId, action_id: id, type: 'action', action: 'wait_page_stable',
      url: page.url(), params: { timeout_ms, dom_stable_ms, overlay_selector: overlay_selector ?? null },
      result: { status: 'ok', duration_ms }, purpose, operator,
    })
    return result
  } catch (err) {
    throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err))
  }
}

// ---------------------------------------------------------------------------
// R07-T03: Interaction primitives — dblclick / focus / check / uncheck /
//          scroll / scroll_into_view / drag + low-level mouse/keyboard
// ---------------------------------------------------------------------------

export async function dblclick(
  page: Actionable, selector: string, timeoutMs = 5000,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.locator(selector).first().dblclick({ timeout: timeoutMs })
    const r = { status: 'ok', selector, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'dblclick', url: (page as Page).url?.(), selector, params: { timeout_ms: timeoutMs }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function focus(
  page: Actionable, selector: string,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.locator(selector).first().focus()
    const r = { status: 'ok', selector, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'focus', url: (page as Page).url?.(), selector, params: {}, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function check(
  page: Actionable, selector: string, timeoutMs = 5000,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.locator(selector).first().check({ timeout: timeoutMs })
    const r = { status: 'ok', selector, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'check', url: (page as Page).url?.(), selector, params: { timeout_ms: timeoutMs }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function uncheck(
  page: Actionable, selector: string, timeoutMs = 5000,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.locator(selector).first().uncheck({ timeout: timeoutMs })
    const r = { status: 'ok', selector, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'uncheck', url: (page as Page).url?.(), selector, params: { timeout_ms: timeoutMs }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export interface ScrollableHint {
  tag: string
  id: string
  className: string
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
}

export async function scroll(
  page: Actionable, selector: string, opts: { delta_x?: number; delta_y?: number } = {},
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; selector: string; delta_x: number; delta_y: number; scrolled: boolean; warning?: string; scrollable_hint?: ScrollableHint[]; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  const { delta_x = 0, delta_y = 300 } = opts
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // Capture scroll position before
    const before = await page.locator(selector).first().evaluate((el: any) => ({
      scrollTop: el.scrollTop ?? 0, scrollLeft: el.scrollLeft ?? 0,
    })).catch(() => ({ scrollTop: 0, scrollLeft: 0 }))

    // Hover over the element, then use mouse wheel (works for both scroll containers and page)
    const box = await page.locator(selector).first().boundingBox()
    if (box) {
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      await (page as Page).mouse?.move(cx, cy)
      await (page as Page).mouse?.wheel(delta_x, delta_y)
    } else {
      // Fallback: scroll the element itself via evaluate
      await page.locator(selector).first().evaluate(
        (el: any, args: number[]) => el.scrollBy(args[0], args[1]),
        [delta_x, delta_y],
      )
    }

    // Capture scroll position after
    const after = await page.locator(selector).first().evaluate((el: any) => ({
      scrollTop: el.scrollTop ?? 0, scrollLeft: el.scrollLeft ?? 0,
    })).catch(() => ({ scrollTop: 0, scrollLeft: 0 }))

    const moved = Math.abs(after.scrollTop - before.scrollTop) + Math.abs(after.scrollLeft - before.scrollLeft)
    const scrolled = moved > 0

    let warning: string | undefined
    let scrollable_hint: ScrollableHint[] | undefined
    if (!scrolled) {
      // Collect top-5 scrollable descendants as hints
      const hints: ScrollableHint[] = await page.locator(selector).first().evaluate((el: any) => {
        const gcs: any = (globalThis as any).getComputedStyle
        const results: any[] = []
        const all = el.querySelectorAll('*')
        for (const child of all) {
          const overflowY = (gcs(child).overflowY ?? '')
          const overflowX = (gcs(child).overflowX ?? '')
          const canScrollY = (overflowY === 'auto' || overflowY === 'scroll') && child.scrollHeight > child.clientHeight
          const canScrollX = (overflowX === 'auto' || overflowX === 'scroll') && child.scrollWidth > child.clientWidth
          if (canScrollY || canScrollX) {
            results.push({
              tag: child.tagName.toLowerCase(),
              id: child.id ?? '',
              className: (child.className ?? '').toString().slice(0, 80),
              scrollHeight: child.scrollHeight,
              clientHeight: child.clientHeight,
              scrollWidth: child.scrollWidth,
              clientWidth: child.clientWidth,
            })
          }
          if (results.length >= 5) break
        }
        return results
      }).catch(() => [] as ScrollableHint[])
      /* eslint-enable @typescript-eslint/no-explicit-any */
      warning = `Scroll had no effect on "${selector}". The element may not be the scrollable container.`
      if (hints.length > 0) scrollable_hint = hints
    }

    const r = { status: 'ok', selector, delta_x, delta_y, scrolled, warning, scrollable_hint, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'scroll', url: (page as Page).url?.(), selector, params: { delta_x, delta_y }, result: { status: r.status, scrolled, duration_ms: r.duration_ms }, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function scrollIntoView(
  page: Actionable, selector: string,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; selector: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.locator(selector).first().scrollIntoViewIfNeeded()
    const r = { status: 'ok', selector, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'scroll_into_view', url: (page as Page).url?.(), selector, params: {}, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function drag(
  page: Page, sourceSelector: string, targetSelector: string,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; source: string; target: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.dragAndDrop(sourceSelector, targetSelector)
    const r = { status: 'ok', source: sourceSelector, target: targetSelector, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'drag', url: page.url(), params: { source: sourceSelector, target: targetSelector }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function mouseMove(
  page: Page, x: number, y: number,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; x: number; y: number; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.mouse.move(x, y)
    const r = { status: 'ok', x, y, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'mouse_move', url: page.url(), params: { x, y }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function mouseDown(
  page: Page, opts: { x?: number; y?: number; button?: 'left' | 'right' | 'middle' } = {},
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    if (opts.x !== undefined && opts.y !== undefined) {
      await page.mouse.move(opts.x, opts.y)
    }
    await page.mouse.down({ button: opts.button ?? 'left' })
    const r = { status: 'ok', duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'mouse_down', url: page.url(), params: opts, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function mouseUp(
  page: Page, button: 'left' | 'right' | 'middle' = 'left',
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.mouse.up({ button })
    const r = { status: 'ok', duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'mouse_up', url: page.url(), params: { button }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function keyDown(
  page: Page, key: string,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; key: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.keyboard.down(key)
    const r = { status: 'ok', key, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'key_down', url: page.url(), params: { key }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function keyUp(
  page: Page, key: string,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; key: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.keyboard.up(key)
    const r = { status: 'ok', key, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'key_up', url: page.url(), params: { key }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

// ---------------------------------------------------------------------------
// R07-T04: Wait / navigation control — back / forward / reload / wait_text /
//          wait_load_state / wait_function
// ---------------------------------------------------------------------------

export async function back(
  page: Page, timeoutMs = 5000, waitUntil: WaitUntil = 'load',
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; url: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.goBack({ timeout: timeoutMs, waitUntil })
    const r = { status: 'ok', url: page.url(), duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'back', url: page.url(), params: { timeout_ms: timeoutMs, wait_until: waitUntil }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function forward(
  page: Page, timeoutMs = 5000, waitUntil: WaitUntil = 'load',
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; url: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.goForward({ timeout: timeoutMs, waitUntil })
    const r = { status: 'ok', url: page.url(), duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'forward', url: page.url(), params: { timeout_ms: timeoutMs, wait_until: waitUntil }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function reload(
  page: Page, timeoutMs = 10000, waitUntil: WaitUntil = 'load',
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; url: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.reload({ timeout: timeoutMs, waitUntil })
    const r = { status: 'ok', url: page.url(), duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'reload', url: page.url(), params: { timeout_ms: timeoutMs, wait_until: waitUntil }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function waitForText(
  page: Actionable, text: string, timeoutMs = 5000,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; text: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await (page as Page).getByText(text).first().waitFor({ state: 'visible', timeout: timeoutMs })
    const r = { status: 'ok', text, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'wait_text', url: (page as Page).url?.(), params: { text, timeout_ms: timeoutMs }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function waitForLoadState(
  page: Page, state: 'load' | 'domcontentloaded' | 'networkidle' = 'load', timeoutMs = 10000,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; state: string; url: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.waitForLoadState(state, { timeout: timeoutMs })
    const r = { status: 'ok', state, url: page.url(), duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'wait_load_state', url: page.url(), params: { state, timeout_ms: timeoutMs }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function waitForFunction(
  page: Page, expression: string, timeoutMs = 5000,
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; url: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.waitForFunction(expression, undefined, { timeout: timeoutMs })
    const r = { status: 'ok', url: page.url(), duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'wait_function', url: page.url(), params: { expression, timeout_ms: timeoutMs }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

// ---------------------------------------------------------------------------
// R07-T08: Generic scroll primitives — scroll_until / load_more_until
// ---------------------------------------------------------------------------

export async function scrollUntil(
  page: Page,
  opts: {
    direction?: 'down' | 'up' | 'left' | 'right'
    scroll_selector?: string
    stop_selector?: string
    stop_text?: string
    max_scrolls?: number
    scroll_delta?: number
    stall_ms?: number
  } = {},
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; scrolls_performed: number; stop_reason: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  const {
    direction = 'down', scroll_selector,
    stop_selector, stop_text,
    max_scrolls = 20, scroll_delta = 400, stall_ms = 500,
  } = opts
  const dx = direction === 'right' ? scroll_delta : direction === 'left' ? -scroll_delta : 0
  const dy = direction === 'down' ? scroll_delta : direction === 'up' ? -scroll_delta : 0

  let scrolls = 0
  let stop_reason = 'max_scrolls'

  try {
    for (let i = 0; i < max_scrolls; i++) {
      // Check stop conditions before scrolling
      if (stop_selector) {
        const count = await page.locator(stop_selector).count()
        if (count > 0) { stop_reason = 'selector_found'; break }
      }
      if (stop_text) {
        const found = await page.evaluate(
          (t: string) => (globalThis as any).document?.body?.innerText?.includes(t) ?? false,
          stop_text,
        )
        if (found) { stop_reason = 'text_found'; break }
      }

      // Perform scroll
      if (scroll_selector) {
        const box = await page.locator(scroll_selector).first().boundingBox()
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        }
      }
      await page.mouse.wheel(dx, dy)
      scrolls++
      await new Promise((r) => setTimeout(r, stall_ms))
    }
    const r = { status: 'ok', scrolls_performed: scrolls, stop_reason, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'scroll_until', url: page.url(), params: opts, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

export async function loadMoreUntil(
  page: Page,
  opts: {
    load_more_selector: string
    content_selector: string
    item_count?: number
    stop_text?: string
    max_loads?: number
    stall_ms?: number
  },
  logger?: AuditLogger, sessionId?: string, purpose?: string, operator?: string,
): Promise<{ status: string; loads_performed: number; final_count: number; stop_reason: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  const { load_more_selector, content_selector, item_count, stop_text, max_loads = 10, stall_ms = 800 } = opts
  let loads = 0
  let stop_reason = 'max_loads'
  let prev_count = -1

  try {
    for (let i = 0; i < max_loads; i++) {
      const current = await page.locator(content_selector).count()

      // Check stop conditions
      if (item_count !== undefined && current >= item_count) { stop_reason = 'item_count_reached'; break }
      if (stop_text) {
        const found = await page.evaluate(
          (t: string) => (globalThis as any).document?.body?.innerText?.includes(t) ?? false,
          stop_text,
        )
        if (found) { stop_reason = 'text_found'; break }
      }
      // Stall detection: no new items
      if (current === prev_count) { stop_reason = 'stalled'; break }
      prev_count = current

      // Check load-more button exists
      const btnCount = await page.locator(load_more_selector).count()
      if (btnCount === 0) { stop_reason = 'load_more_gone'; break }

      await page.click(load_more_selector)
      loads++
      await new Promise((r) => setTimeout(r, stall_ms))
    }
    const final_count = await page.locator(content_selector).count()
    const r = { status: 'ok', loads_performed: loads, final_count, stop_reason, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'load_more_until', url: page.url(), params: opts, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
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

// ---------------------------------------------------------------------------
// R07-C04: T19 — coordinate-based primitives (click_at / wheel / insert_text)
// ---------------------------------------------------------------------------

/** Click at an absolute page coordinate. */
export async function clickAt(
  page: Page,
  x: number,
  y: number,
  opts: { button?: 'left' | 'right' | 'middle'; click_count?: number; delay_ms?: number } = {},
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; x: number; y: number; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.mouse.click(x, y, {
      button: opts.button ?? 'left',
      clickCount: opts.click_count ?? 1,
      delay: opts.delay_ms ?? 0,
    })
    const r = { status: 'ok', x, y, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'click_at', url: page.url(), params: { x, y, ...opts }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

/** Dispatch a mouse wheel event at the current cursor position. */
export async function wheelAt(
  page: Page,
  dx: number,
  dy: number,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; dx: number; dy: number; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.mouse.wheel(dx, dy)
    const r = { status: 'ok', dx, dy, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'wheel_at', url: page.url(), params: { dx, dy }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

/**
 * Insert text directly into the focused element, bypassing key events.
 * Useful for emoji, CJK characters, or any input that would be mangled
 * by synthesised keydown/keyup sequences.
 */
export async function insertText(
  page: Page,
  text: string,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; length: number; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.keyboard.insertText(text)
    const r = { status: 'ok', length: text.length, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'insert_text', url: page.url(), params: { length: text.length }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

// ---------------------------------------------------------------------------
// R07-C04: T20 — bounding box retrieval (ref→bbox→input pipeline)
// ---------------------------------------------------------------------------

export interface BboxInfo {
  found: boolean
  x: number
  y: number
  width: number
  height: number
  center_x: number
  center_y: number
}

/** Return the bounding box of the first element matching *selector*. */
export async function getBbox(
  page: Actionable,
  selector: string,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; selector: string } & (BboxInfo | { found: false; x: 0; y: 0; width: 0; height: 0; center_x: 0; center_y: 0 }) & { duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    // Use a short timeout so non-existent selectors return found:false immediately
    // instead of waiting for the default 30s Playwright timeout.
    let box: { x: number; y: number; width: number; height: number } | null = null
    try {
      box = await page.locator(selector).first().boundingBox({ timeout: 2000 })
    } catch (_te) {
      box = null  // element not found within timeout → treat as not-found
    }
    const duration_ms = Date.now() - t0
    if (!box) {
      const r = { status: 'ok', selector, found: false as const, x: 0 as const, y: 0 as const, width: 0 as const, height: 0 as const, center_x: 0 as const, center_y: 0 as const, duration_ms }
      logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'bbox', url: page.url(), params: { selector }, result: r, purpose, operator })
      return r
    }
    const r = {
      status: 'ok', selector, found: true as const,
      x: box.x, y: box.y, width: box.width, height: box.height,
      center_x: box.x + box.width / 2, center_y: box.y + box.height / 2,
      duration_ms,
    }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'bbox', url: page.url(), params: { selector }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

// ---------------------------------------------------------------------------
// R07-C04: T24 — viewport emulation
// ---------------------------------------------------------------------------

export async function setViewport(
  page: Page,
  width: number,
  height: number,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; width: number; height: number; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.setViewportSize({ width, height })
    const r = { status: 'ok', width, height, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'set_viewport', url: page.url(), params: { width, height }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

// ---------------------------------------------------------------------------
// R07-C04: T23 — clipboard read/write
// ---------------------------------------------------------------------------

/** Write *text* to the system clipboard via the Clipboard API. */
export async function clipboardWrite(
  page: Page,
  text: string,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; length: number; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    await page.evaluate(async (t: string) => {
      if ((navigator as any).clipboard?.writeText) {
        await (navigator as any).clipboard.writeText(t)
      } else {
        // execCommand fallback (deprecated but reliable in Chromium)
        // Use globalThis to avoid TypeScript node-lib "document not found" error
        const doc = (globalThis as any).document
        const el = doc.createElement('textarea')
        el.value = t
        el.style.position = 'fixed'
        el.style.opacity = '0'
        doc.body.appendChild(el)
        el.select()
        doc.execCommand('copy')
        el.remove()
      }
    }, text)
    const r = { status: 'ok', length: text.length, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'clipboard_write', url: page.url(), params: { length: text.length }, result: r, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}

/**
 * Read text from the system clipboard.
 * Requires the `clipboard-read` permission; may fail in restricted headless
 * environments.  Grant via `context.grantPermissions(['clipboard-read'])`.
 */
export async function clipboardRead(
  page: Page,
  logger?: AuditLogger,
  sessionId?: string,
  purpose?: string,
  operator?: string,
): Promise<{ status: string; text: string; duration_ms: number }> {
  const id = actionId(); const t0 = Date.now()
  try {
    const text = await page.evaluate(async () => {
      return await (navigator as any).clipboard.readText()
    }) as string
    const r = { status: 'ok', text, duration_ms: Date.now() - t0 }
    logger?.write({ session_id: sessionId, action_id: id, type: 'action', action: 'clipboard_read', url: page.url(), params: {}, result: { status: 'ok', length: text.length, duration_ms: r.duration_ms }, purpose, operator })
    return r
  } catch (err) { throw new ActionDiagnosticsError(await collectDiagnostics(page, t0, err)) }
}
