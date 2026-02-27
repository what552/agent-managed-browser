import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { apiPost, apiGet, apiDelete, apiPut } from '../client'

function collectValues(val: string, prev: string[]): string[] {
  return prev.concat([val])
}

function printDiagnostics(res: Record<string, unknown>): void {
  console.error('Error:', res.error)
  if (res.url) console.error('  url:', res.url)
  if (res.title) console.error('  title:', res.title)
  if (res.readyState) console.error('  readyState:', res.readyState)
  if (res.elapsedMs != null) console.error('  elapsedMs:', res.elapsedMs)
  if (res.stack) console.error('  stack:', res.stack)
}

export function actionCommands(program: Command): void {
  program
    .command('navigate <session-id> <url>')
    .description('Navigate to URL')
    .option('--wait-until <event>', 'Wait until event (load|networkidle|commit)', 'load')
    .action(async (sessionId, url, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/navigate`, {
        url,
        wait_until: opts.waitUntil,
      })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`Navigated to: ${res.url}  (${res.duration_ms}ms)`)
      console.log(`Title: ${res.title}`)
    })

  program
    .command('screenshot <session-id>')
    .description('Capture screenshot')
    .option('-o, --out <file>', 'Output file path', './screenshot.png')
    .option('--full-page', 'Capture full page')
    .option('--format <fmt>', 'Format: png|jpeg', 'png')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/screenshot`, {
        format: opts.format,
        full_page: opts.fullPage,
      })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      const buf = Buffer.from(res.data, 'base64')
      fs.writeFileSync(opts.out, buf)
      console.log(`✓ Screenshot saved to ${opts.out} (${(buf.length / 1024).toFixed(1)}KB, ${res.duration_ms}ms)`)
    })

  program
    .command('eval <session-id> <expression>')
    .description('Evaluate JavaScript expression in browser')
    .action(async (sessionId, expression) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/eval`, { expression })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(JSON.stringify(res.result, null, 2))
    })

  program
    .command('extract <session-id> <selector>')
    .description('Extract text/attributes from elements matching selector')
    .option('--attr <name>', 'Extract attribute value instead of text content')
    .action(async (sessionId, selector, opts) => {
      const body: Record<string, string> = { selector }
      if (opts.attr) body.attribute = opts.attr
      const res = await apiPost(`/api/v1/sessions/${sessionId}/extract`, body)
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`Found ${res.count} element(s) matching "${selector}":`)
      for (const item of res.items) {
        console.log(' ', JSON.stringify(item))
      }
    })

  program
    .command('click <session-id> <selector-or-eid>')
    .description('Click an element (use --element-id to treat arg as element_id from element-map)')
    .option('--element-id', 'Treat selector-or-eid as an element_id from element-map')
    .action(async (sessionId, selectorOrEid, opts) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = opts.elementId ? { element_id: selectorOrEid } : { selector: selectorOrEid }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/click`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Clicked "${selectorOrEid}" (${res.duration_ms}ms)`)
    })

  program
    .command('fill <session-id> <selector-or-eid> <value>')
    .description('Fill a form field (use --element-id to treat first arg as element_id from element-map)')
    .option('--element-id', 'Treat selector-or-eid as an element_id from element-map')
    .action(async (sessionId, selectorOrEid, value, opts) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = opts.elementId
        ? { element_id: selectorOrEid, value }
        : { selector: selectorOrEid, value }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/fill`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Filled "${selectorOrEid}" (${res.duration_ms}ms)`)
    })

  program
    .command('logs <session-id>')
    .description('Show audit logs for a session')
    .option('--tail <n>', 'Last N entries', '20')
    .action(async (sessionId, opts) => {
      const res = await apiGet(`/api/v1/sessions/${sessionId}/logs?tail=${opts.tail}`)
      if (!Array.isArray(res)) { console.log(JSON.stringify(res, null, 2)); return }
      for (const entry of res) {
        console.log(`[${entry.ts}] ${entry.action ?? entry.type}  ${entry.url ?? ''}  ${entry.result?.status ?? ''}  ${entry.result?.duration_ms ?? ''}ms`)
      }
    })

  program
    .command('login <session-id>')
    .description('Interactive login handoff: switch to headed, wait for you to log in, then restore headless automation')
    .action(async (sessionId) => {
      const start = await apiPost(`/api/v1/sessions/${sessionId}/handoff/start`, {})
      if (start.error) { console.error('Error:', start.error); process.exit(1) }
      console.log(`Browser is now visible for session ${sessionId}.`)
      console.log('Log in manually in the browser window.')
      console.log('Press Enter here when done to return to headless automation...')

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      await new Promise<void>((resolve) => rl.question('', () => { rl.close(); resolve() }))

      const complete = await apiPost(`/api/v1/sessions/${sessionId}/handoff/complete`, {})
      if (complete.error) { console.error('Error:', complete.error); process.exit(1) }
      console.log(`✓ Session ${sessionId} returned to headless mode. Automation can resume.`)
    })

  program
    .command('type <session-id> <selector> <text>')
    .description('Type text into an element character by character')
    .option('--delay-ms <ms>', 'Delay between keystrokes (ms)', '0')
    .action(async (sessionId, selector, text, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/type`, { selector, text, delay_ms: parseInt(opts.delayMs) })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Typed into "${selector}" (${res.duration_ms}ms)`)
    })

  program
    .command('press <session-id> <selector> <key>')
    .description('Press a key or combo (e.g. Enter, Tab, Control+a)')
    .action(async (sessionId, selector, key) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/press`, { selector, key })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Pressed "${key}" on "${selector}" (${res.duration_ms}ms)`)
    })

  program
    .command('select <session-id> <selector> <value...>')
    .description('Select option(s) from a <select> element')
    .action(async (sessionId, selector, values) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/select`, { selector, values })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Selected [${res.selected.join(', ')}] in "${selector}" (${res.duration_ms}ms)`)
    })

  program
    .command('hover <session-id> <selector>')
    .description('Hover over an element')
    .action(async (sessionId, selector) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/hover`, { selector })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Hovered over "${selector}" (${res.duration_ms}ms)`)
    })

  program
    .command('wait-selector <session-id> <selector>')
    .description('Wait for an element to match state')
    .option('--state <state>', 'visible|hidden|attached|detached', 'visible')
    .option('--timeout-ms <ms>', 'Timeout in ms', '5000')
    .action(async (sessionId, selector, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/wait_for_selector`, {
        selector, state: opts.state, timeout_ms: parseInt(opts.timeoutMs),
      })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Selector "${selector}" is ${res.state} (${res.duration_ms}ms)`)
    })

  program
    .command('wait-response <session-id> <url-pattern>')
    .description('Wait for a network response matching URL pattern')
    .option('--timeout-ms <ms>', 'Timeout in ms', '10000')
    .option('--trigger-navigate <url>', 'Navigate to this URL to trigger the response')
    .action(async (sessionId, urlPattern, opts) => {
      const body: Record<string, unknown> = { url_pattern: urlPattern, timeout_ms: parseInt(opts.timeoutMs) }
      if (opts.triggerNavigate) body.trigger = { type: 'navigate', url: opts.triggerNavigate }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/wait_for_response`, body)
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Response matched: ${res.url} [HTTP ${res.status_code}] (${res.duration_ms}ms)`)
    })

  program
    .command('wait-url <session-id> <url-pattern>')
    .description('Wait for the page URL to match a pattern (glob or full URL)')
    .option('--timeout-ms <ms>', 'Timeout in ms', '5000')
    .action(async (sessionId, urlPattern, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/wait_for_url`, {
        url_pattern: urlPattern, timeout_ms: parseInt(opts.timeoutMs),
      })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ URL matched: ${res.url} (${res.duration_ms}ms)`)
    })

  program
    .command('upload <session-id> <selector> <file>')
    .description('Upload a local file to a file input element')
    .option('--mime-type <type>', 'MIME type', 'application/octet-stream')
    .action(async (sessionId, selector, file, opts) => {
      const buf = fs.readFileSync(file)
      const res = await apiPost(`/api/v1/sessions/${sessionId}/upload`, {
        selector,
        content: buf.toString('base64'),
        filename: path.basename(file),
        mime_type: opts.mimeType,
      })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Uploaded "${res.filename}" (${res.size_bytes} bytes, ${res.duration_ms}ms)`)
    })

  program
    .command('download <session-id> <selector>')
    .description('Click a download link and save the file')
    .option('-o, --out <file>', 'Output file path (default: suggested filename)')
    .option('--timeout-ms <ms>', 'Timeout in ms', '30000')
    .action(async (sessionId, selector, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/download`, {
        selector, timeout_ms: parseInt(opts.timeoutMs),
      })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      const outPath = opts.out ?? res.filename
      fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'))
      console.log(`✓ Downloaded "${res.filename}" → ${outPath} (${res.size_bytes} bytes, ${res.duration_ms}ms)`)
    })

  program
    .command('headed <session-id>')
    .description('Switch session to headed (visible) mode')
    .action(async (sessionId) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/mode`, { mode: 'headed' })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Session ${sessionId} switched to headed mode`)
    })

  program
    .command('headless <session-id>')
    .description('Switch session to headless mode')
    .action(async (sessionId) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/mode`, { mode: 'headless' })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Session ${sessionId} switched to headless mode`)
    })

  program
    .command('policy <session-id> [profile]')
    .description('Get or set the safety execution policy for a session (safe|permissive|disabled)')
    .option('--allow-sensitive', 'Enable sensitive action guardrail override')
    .option('--deny-sensitive', 'Disable sensitive action guardrail override')
    .action(async (sessionId, profile, opts) => {
      if (!profile) {
        // GET current policy
        const res = await apiGet(`/api/v1/sessions/${sessionId}/policy`)
        if (res.error) { console.error('Error:', res.error); process.exit(1) }
        console.log(`Profile: ${res.profile}`)
        console.log(`  domain_min_interval_ms: ${res.domain_min_interval_ms}`)
        console.log(`  jitter_ms: [${(res.jitter_ms ?? []).join(', ')}]`)
        console.log(`  cooldown_after_error_ms: ${res.cooldown_after_error_ms}`)
        console.log(`  max_retries_per_domain: ${res.max_retries_per_domain}`)
        console.log(`  max_actions_per_minute: ${res.max_actions_per_minute}`)
        console.log(`  allow_sensitive_actions: ${res.allow_sensitive_actions}`)
      } else {
        // SET policy
        const body: Record<string, unknown> = { profile }
        if (opts.allowSensitive) body.allow_sensitive_actions = true
        if (opts.denySensitive) body.allow_sensitive_actions = false
        const res = await apiPost(`/api/v1/sessions/${sessionId}/policy`, body)
        if (res.error) { console.error('Error:', res.error); process.exit(1) }
        console.log(`✓ Policy set for session ${sessionId}: ${res.profile}`)
        console.log(`  allow_sensitive_actions: ${res.allow_sensitive_actions}`)
      }
    })

  program
    .command('cdp-ws <session-id>')
    .description('Print the browser-level CDP WebSocket URL for the session')
    .action(async (sessionId) => {
      const res = await apiGet(`/api/v1/sessions/${sessionId}/cdp/ws`)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      const wsUrl = res.browser_ws_url
      if (wsUrl) {
        console.log(wsUrl)
      } else {
        console.log(`(no WebSocket URL available — session ${sessionId})`)
        console.log('Note: CDP WS URL is only available when using a full browser launch (not persistent context).')
      }
    })

  // ---------------------------------------------------------------------------
  // R07-T01/T02/T07 — element_map, get, assert, wait-stable
  // ---------------------------------------------------------------------------

  program
    .command('element-map <session-id>')
    .description('Scan the page and return a numbered element map (assigns stable element IDs)')
    .option('--scope <selector>', 'Limit scan to elements inside this CSS selector')
    .option('--limit <n>', 'Max elements to return', '500')
    .option('--json', 'Output raw JSON instead of a table')
    .action(async (sessionId, opts) => {
      const body: Record<string, unknown> = { limit: parseInt(opts.limit) }
      if (opts.scope) body.scope = opts.scope
      const res = await apiPost(`/api/v1/sessions/${sessionId}/element_map`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      if (opts.json) { console.log(JSON.stringify(res, null, 2)); return }
      const elements: Array<Record<string, unknown>> = res.elements ?? []
      if (elements.length === 0) { console.log('No interactive elements found.'); return }
      console.log(`Found ${elements.length} element(s) on ${res.url}:`)
      for (const el of elements) {
        const blocked = el.overlay_blocked ? ' [overlay-blocked]' : ''
        const text = String(el.text ?? '').slice(0, 60).replace(/\n/g, ' ')
        console.log(`  ${el.element_id}  <${el.tag}> role=${el.role}${blocked}  ${text}`)
      }
    })

  program
    .command('get <session-id> <property> <selector-or-eid>')
    .description('Read a property from an element (text|html|value|attr|count|box)')
    .option('--attr-name <name>', 'Attribute name (required when property=attr)')
    .option('--element-id', 'Treat selector-or-eid as an element_id from element-map')
    .action(async (sessionId, property, target, opts) => {
      const body: Record<string, unknown> = { property }
      if (opts.elementId) {
        body.element_id = target
      } else {
        body.selector = target
      }
      if (opts.attrName) body.attr_name = opts.attrName
      const res = await apiPost(`/api/v1/sessions/${sessionId}/get`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(JSON.stringify(res.value, null, 2))
    })

  program
    .command('assert <session-id> <property> <selector-or-eid>')
    .description('Assert element state: visible|enabled|checked')
    .option('--element-id', 'Treat selector-or-eid as an element_id from element-map')
    .option('--expected <bool>', 'Expected value (true|false)', 'true')
    .action(async (sessionId, property, target, opts) => {
      const body: Record<string, unknown> = { property, expected: opts.expected !== 'false' }
      if (opts.elementId) {
        body.element_id = target
      } else {
        body.selector = target
      }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/assert`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      const icon = res.passed ? '✓' : '✗'
      console.log(`${icon} ${property}: actual=${res.actual} expected=${res.expected} — ${res.passed ? 'PASS' : 'FAIL'}`)
      if (!res.passed) process.exit(1)
    })

  program
    .command('wait-stable <session-id>')
    .description('Wait for page to be stable (network idle + DOM quiescence)')
    .option('--timeout-ms <ms>', 'Timeout in ms', '10000')
    .option('--dom-stable-ms <ms>', 'DOM must be mutation-free for this many ms', '300')
    .option('--overlay-selector <selector>', 'Also wait until no element matches this selector')
    .action(async (sessionId, opts) => {
      const body: Record<string, unknown> = {
        timeout_ms: parseInt(opts.timeoutMs),
        dom_stable_ms: parseInt(opts.domStableMs),
      }
      if (opts.overlaySelector) body.overlay_selector = opts.overlaySelector
      const res = await apiPost(`/api/v1/sessions/${sessionId}/wait_page_stable`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Page stable (${res.waited_ms}ms)`)
    })

  // ---------------------------------------------------------------------------
  // R07-T02/T13 — snapshot-map
  // ---------------------------------------------------------------------------

  program
    .command('snapshot-map <session-id>')
    .description('Snapshot the page element map with page_rev tracking (returns ref_ids for stable targeting)')
    .option('--scope <selector>', 'Limit scan to elements inside this CSS selector')
    .option('--limit <n>', 'Max elements to return', '500')
    .option('--json', 'Output raw JSON instead of a table')
    .action(async (sessionId, opts) => {
      const body: Record<string, unknown> = { limit: parseInt(opts.limit) }
      if (opts.scope) body.scope = opts.scope
      const res = await apiPost(`/api/v1/sessions/${sessionId}/snapshot_map`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      if (opts.json) { console.log(JSON.stringify(res, null, 2)); return }
      const elements: Array<Record<string, unknown>> = res.elements ?? []
      console.log(`Snapshot ${res.snapshot_id} (page_rev=${res.page_rev}) — ${elements.length} element(s) on ${res.url}:`)
      for (const el of elements) {
        const blocked = el.overlay_blocked ? ' [overlay-blocked]' : ''
        const text = String(el.text ?? '').slice(0, 60).replace(/\n/g, ' ')
        console.log(`  ${el.ref_id}  <${el.tag}> role=${el.role}${blocked}  ${text}`)
      }
    })

  // ---------------------------------------------------------------------------
  // R07-T03 — additional interaction primitives
  // ---------------------------------------------------------------------------

  program
    .command('dblclick <session-id> <selector-or-eid>')
    .description('Double-click an element')
    .option('--element-id', 'Treat selector-or-eid as an element_id from element-map')
    .option('--timeout-ms <ms>', 'Timeout in ms', '5000')
    .action(async (sessionId, selectorOrEid, opts) => {
      const body: Record<string, unknown> = opts.elementId
        ? { element_id: selectorOrEid }
        : { selector: selectorOrEid }
      body.timeout_ms = parseInt(opts.timeoutMs)
      const res = await apiPost(`/api/v1/sessions/${sessionId}/dblclick`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Double-clicked "${selectorOrEid}" (${res.duration_ms}ms)`)
    })

  program
    .command('focus <session-id> <selector-or-eid>')
    .description('Focus an element')
    .option('--element-id', 'Treat selector-or-eid as an element_id from element-map')
    .action(async (sessionId, selectorOrEid, opts) => {
      const body: Record<string, unknown> = opts.elementId
        ? { element_id: selectorOrEid }
        : { selector: selectorOrEid }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/focus`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Focused "${selectorOrEid}" (${res.duration_ms}ms)`)
    })

  program
    .command('check <session-id> <selector-or-eid>')
    .description('Check a checkbox or radio button')
    .option('--element-id', 'Treat selector-or-eid as an element_id from element-map')
    .action(async (sessionId, selectorOrEid, opts) => {
      const body: Record<string, unknown> = opts.elementId
        ? { element_id: selectorOrEid }
        : { selector: selectorOrEid }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/check`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Checked "${selectorOrEid}" (${res.duration_ms}ms)`)
    })

  program
    .command('uncheck <session-id> <selector-or-eid>')
    .description('Uncheck a checkbox')
    .option('--element-id', 'Treat selector-or-eid as an element_id from element-map')
    .action(async (sessionId, selectorOrEid, opts) => {
      const body: Record<string, unknown> = opts.elementId
        ? { element_id: selectorOrEid }
        : { selector: selectorOrEid }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/uncheck`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Unchecked "${selectorOrEid}" (${res.duration_ms}ms)`)
    })

  program
    .command('scroll <session-id> <selector-or-eid>')
    .description('Scroll an element by delta pixels')
    .option('--element-id', 'Treat selector-or-eid as an element_id from element-map')
    .option('--dx <px>', 'Horizontal scroll delta', '0')
    .option('--dy <px>', 'Vertical scroll delta', '300')
    .action(async (sessionId, selectorOrEid, opts) => {
      const body: Record<string, unknown> = opts.elementId
        ? { element_id: selectorOrEid }
        : { selector: selectorOrEid }
      body.delta_x = parseInt(opts.dx)
      body.delta_y = parseInt(opts.dy)
      const res = await apiPost(`/api/v1/sessions/${sessionId}/scroll`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Scrolled "${selectorOrEid}" (${res.duration_ms}ms)`)
    })

  program
    .command('scroll-into-view <session-id> <selector-or-eid>')
    .description('Scroll element into view')
    .option('--element-id', 'Treat selector-or-eid as an element_id from element-map')
    .action(async (sessionId, selectorOrEid, opts) => {
      const body: Record<string, unknown> = opts.elementId
        ? { element_id: selectorOrEid }
        : { selector: selectorOrEid }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/scroll_into_view`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Scrolled "${selectorOrEid}" into view (${res.duration_ms}ms)`)
    })

  program
    .command('drag <session-id> <source> <target>')
    .description('Drag an element from source to target (CSS selectors)')
    .option('--timeout-ms <ms>', 'Timeout in ms', '5000')
    .action(async (sessionId, source, target, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/drag`, { source, target, timeout_ms: parseInt(opts.timeoutMs) })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Dragged "${source}" → "${target}" (${res.duration_ms}ms)`)
    })

  program
    .command('mouse-move <session-id> <x> <y>')
    .description('Move mouse to absolute page coordinates')
    .action(async (sessionId, x, y) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/mouse_move`, { x: parseFloat(x), y: parseFloat(y) })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Mouse moved to (${x},${y}) (${res.duration_ms}ms)`)
    })

  program
    .command('mouse-down <session-id>')
    .description('Press the left mouse button at current position')
    .option('--button <btn>', 'Mouse button: left|right|middle', 'left')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/mouse_down`, { button: opts.button })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Mouse down (${res.duration_ms}ms)`)
    })

  program
    .command('mouse-up <session-id>')
    .description('Release the left mouse button at current position')
    .option('--button <btn>', 'Mouse button: left|right|middle', 'left')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/mouse_up`, { button: opts.button })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Mouse up (${res.duration_ms}ms)`)
    })

  program
    .command('key-down <session-id> <key>')
    .description('Press a keyboard key (hold down)')
    .action(async (sessionId, key) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/key_down`, { key })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Key down "${key}" (${res.duration_ms}ms)`)
    })

  program
    .command('key-up <session-id> <key>')
    .description('Release a keyboard key')
    .action(async (sessionId, key) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/key_up`, { key })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Key up "${key}" (${res.duration_ms}ms)`)
    })

  // ---------------------------------------------------------------------------
  // R07-T04 — navigation control
  // ---------------------------------------------------------------------------

  program
    .command('back <session-id>')
    .description('Navigate back in browser history')
    .option('--timeout-ms <ms>', 'Timeout in ms', '5000')
    .option('--wait-until <event>', 'Wait until event (load|networkidle|commit)', 'load')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/back`, { timeout_ms: parseInt(opts.timeoutMs), wait_until: opts.waitUntil })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Back → ${res.url} (${res.duration_ms}ms)`)
    })

  program
    .command('forward <session-id>')
    .description('Navigate forward in browser history')
    .option('--timeout-ms <ms>', 'Timeout in ms', '5000')
    .option('--wait-until <event>', 'Wait until event (load|networkidle|commit)', 'load')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/forward`, { timeout_ms: parseInt(opts.timeoutMs), wait_until: opts.waitUntil })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Forward → ${res.url} (${res.duration_ms}ms)`)
    })

  program
    .command('reload <session-id>')
    .description('Reload the current page')
    .option('--timeout-ms <ms>', 'Timeout in ms', '10000')
    .option('--wait-until <event>', 'Wait until event (load|networkidle|commit)', 'load')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/reload`, { timeout_ms: parseInt(opts.timeoutMs), wait_until: opts.waitUntil })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Reloaded → ${res.url} (${res.duration_ms}ms)`)
    })

  program
    .command('wait-text <session-id> <text>')
    .description('Wait for text to appear on the page')
    .option('--timeout-ms <ms>', 'Timeout in ms', '5000')
    .action(async (sessionId, text, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/wait_text`, { text, timeout_ms: parseInt(opts.timeoutMs) })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Text "${text}" appeared (${res.duration_ms}ms)`)
    })

  program
    .command('wait-load-state <session-id>')
    .description('Wait for a specific page load state (load|networkidle|domcontentloaded)')
    .option('--state <state>', 'Load state to wait for', 'load')
    .option('--timeout-ms <ms>', 'Timeout in ms', '10000')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/wait_load_state`, { state: opts.state, timeout_ms: parseInt(opts.timeoutMs) })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Load state "${res.state}" on ${res.url} (${res.duration_ms}ms)`)
    })

  program
    .command('wait-function <session-id> <expression>')
    .description('Wait until a JS expression returns truthy')
    .option('--timeout-ms <ms>', 'Timeout in ms', '5000')
    .action(async (sessionId, expression, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/wait_function`, { expression, timeout_ms: parseInt(opts.timeoutMs) })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Function resolved on ${res.url} (${res.duration_ms}ms)`)
    })

  // ---------------------------------------------------------------------------
  // R07-T08 — scroll primitives
  // ---------------------------------------------------------------------------

  program
    .command('scroll-until <session-id>')
    .description('Scroll the page until a stop condition is met')
    .option('--direction <dir>', 'Scroll direction: down|up|left|right', 'down')
    .option('--scroll-selector <sel>', 'CSS selector of element to scroll (default: page body)')
    .option('--stop-selector <sel>', 'Stop when this selector becomes visible')
    .option('--stop-text <text>', 'Stop when this text appears on page')
    .option('--max-scrolls <n>', 'Maximum scroll steps', '50')
    .option('--scroll-delta <px>', 'Pixels per scroll step', '300')
    .option('--stall-ms <ms>', 'Stop if page height unchanged for this many ms', '1500')
    .action(async (sessionId, opts) => {
      const body: Record<string, unknown> = {
        direction: opts.direction,
        max_scrolls: parseInt(opts.maxScrolls),
        scroll_delta: parseInt(opts.scrollDelta),
        stall_ms: parseInt(opts.stallMs),
      }
      if (opts.scrollSelector) body.scroll_selector = opts.scrollSelector
      if (opts.stopSelector) body.stop_selector = opts.stopSelector
      if (opts.stopText) body.stop_text = opts.stopText
      const res = await apiPost(`/api/v1/sessions/${sessionId}/scroll_until`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Scroll done — ${res.scrolls_performed} scrolls, stopped: ${res.stop_reason} (${res.duration_ms}ms)`)
    })

  // ---------------------------------------------------------------------------
  // R07-T05 — Cookie and storage state
  // ---------------------------------------------------------------------------

  program
    .command('cookie-list <session-id>')
    .description('List all cookies for a session')
    .option('--json', 'Output raw JSON')
    .option('--urls <csv>', 'Filter by comma-separated URL list')
    .action(async (sessionId, opts) => {
      const qs = opts.urls ? `?urls=${encodeURIComponent(opts.urls)}` : ''
      const res = await apiGet(`/api/v1/sessions/${sessionId}/cookies${qs}`)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      if (opts.json) { console.log(JSON.stringify(res, null, 2)); return }
      const cookies: Array<Record<string, unknown>> = res.cookies ?? []
      console.log(`${cookies.length} cookie(s) for session ${sessionId}:`)
      for (const c of cookies) console.log(`  ${c.name}=${String(c.value).slice(0, 40)}  domain=${c.domain}  path=${c.path}`)
    })

  program
    .command('cookie-clear <session-id>')
    .description('Clear all cookies for a session')
    .action(async (sessionId) => {
      const { statusCode } = await apiDelete(`/api/v1/sessions/${sessionId}/cookies`)
      if (statusCode >= 400) { console.error(`Error: HTTP ${statusCode}`); process.exit(1) }
      console.log(`✓ Cookies cleared for session ${sessionId}`)
    })

  program
    .command('storage-export <session-id>')
    .description('Export the full Playwright storageState (cookies + origins) as JSON')
    .option('-o, --out <file>', 'Save to file instead of stdout')
    .action(async (sessionId, opts) => {
      const res = await apiGet(`/api/v1/sessions/${sessionId}/storage_state`)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      const json = JSON.stringify(res.storage_state, null, 2)
      if (opts.out) { fs.writeFileSync(opts.out, json); console.log(`✓ Storage state saved to ${opts.out}`) }
      else console.log(json)
    })

  program
    .command('storage-import <session-id> <file>')
    .description('Restore cookies from a previously exported storageState JSON file')
    .action(async (sessionId, file) => {
      const storage_state = JSON.parse(fs.readFileSync(file, 'utf8'))
      const res = await apiPost(`/api/v1/sessions/${sessionId}/storage_state`, { storage_state })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Restored ${res.cookies_restored} cookie(s) for session ${sessionId}`)
    })

  // ---------------------------------------------------------------------------
  // R07-T15 — Annotated screenshot
  // ---------------------------------------------------------------------------

  program
    .command('annotated-screenshot <session-id>')
    .description('Take a screenshot with CSS highlight overlays on selected elements')
    .option('-o, --out <file>', 'Output file path', './annotated.png')
    .option('--highlight <selector>', 'CSS selector to highlight (repeatable)', collectValues, [])
    .option('--color <css-color>', 'Highlight color (CSS)', 'rgba(255,80,80,0.35)')
    .option('--format <fmt>', 'png|jpeg', 'png')
    .option('--full-page', 'Capture full page')
    .action(async (sessionId, opts) => {
      const highlights = (opts.highlight as string[]).map((selector: string) => ({ selector, color: opts.color }))
      if (highlights.length === 0) {
        console.error('Error: at least one --highlight <selector> is required')
        process.exit(1)
      }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/annotated_screenshot`, {
        highlights, format: opts.format, full_page: opts.fullPage,
      })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      const buf = Buffer.from(res.data, 'base64')
      fs.writeFileSync(opts.out, buf)
      console.log(`✓ Annotated screenshot saved to ${opts.out} (${highlights.length} highlight(s), ${(buf.length / 1024).toFixed(1)}KB, ${res.duration_ms}ms)`)
    })

  // ---------------------------------------------------------------------------
  // R07-T16/T17 — Observability: console log + page errors
  // ---------------------------------------------------------------------------

  program
    .command('console-log <session-id>')
    .description('Show collected browser console log entries')
    .option('--tail <n>', 'Last N entries', '50')
    .option('--json', 'Output raw JSON')
    .action(async (sessionId, opts) => {
      const res = await apiGet(`/api/v1/sessions/${sessionId}/console?tail=${opts.tail}`)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      if (opts.json) { console.log(JSON.stringify(res, null, 2)); return }
      const entries: Array<Record<string, unknown>> = res.entries ?? []
      if (entries.length === 0) { console.log('(no console entries)'); return }
      for (const e of entries) console.log(`[${e.ts}] ${e.type}  ${e.text}`)
    })

  program
    .command('page-errors <session-id>')
    .description('Show collected uncaught page errors')
    .option('--tail <n>', 'Last N entries', '20')
    .option('--json', 'Output raw JSON')
    .action(async (sessionId, opts) => {
      const res = await apiGet(`/api/v1/sessions/${sessionId}/page_errors?tail=${opts.tail}`)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      if (opts.json) { console.log(JSON.stringify(res, null, 2)); return }
      const entries: Array<Record<string, unknown>> = res.entries ?? []
      if (entries.length === 0) { console.log('(no page errors)'); return }
      for (const e of entries) console.log(`[${e.ts}] ERROR  ${e.message}  url=${e.url}`)
    })

  program
    .command('load-more-until <session-id> <load-more-selector> <content-selector>')
    .description('Repeatedly click a "Load More" button until content count or text condition is met')
    .option('--item-count <n>', 'Stop when at least N items matching content-selector are loaded')
    .option('--stop-text <text>', 'Stop when this text appears on page')
    .option('--max-loads <n>', 'Maximum number of load-more clicks', '20')
    .option('--stall-ms <ms>', 'Stop if item count unchanged for this many ms', '2000')
    .action(async (sessionId, loadMoreSelector, contentSelector, opts) => {
      const body: Record<string, unknown> = {
        load_more_selector: loadMoreSelector,
        content_selector: contentSelector,
        max_loads: parseInt(opts.maxLoads),
        stall_ms: parseInt(opts.stallMs),
      }
      if (opts.itemCount) body.item_count = parseInt(opts.itemCount)
      if (opts.stopText) body.stop_text = opts.stopText
      const res = await apiPost(`/api/v1/sessions/${sessionId}/load_more_until`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Load-more done — ${res.loads_performed} loads, ${res.final_count} items, stopped: ${res.stop_reason} (${res.duration_ms}ms)`)
    })

  // ---------------------------------------------------------------------------
  // R07-T19 — Coordinate-based input primitives
  // ---------------------------------------------------------------------------

  program
    .command('click-at <session-id> <x> <y>')
    .description('Click at pixel coordinates (x, y) — bypasses selector resolution')
    .option('--button <btn>', 'Mouse button: left|right|middle', 'left')
    .option('--click-count <n>', 'Number of clicks', '1')
    .option('--delay-ms <ms>', 'Delay between mousedown and mouseup (ms)', '0')
    .action(async (sessionId, x, y, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/click_at`, {
        x: parseFloat(x), y: parseFloat(y),
        button: opts.button, click_count: parseInt(opts.clickCount), delay_ms: parseInt(opts.delayMs),
      })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Clicked at (${res.x}, ${res.y}) (${res.duration_ms}ms)`)
    })

  program
    .command('wheel <session-id>')
    .description('Dispatch a mouse wheel event at the current cursor position')
    .option('--dx <px>', 'Horizontal scroll delta', '0')
    .option('--dy <px>', 'Vertical scroll delta', '300')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/wheel`, {
        dx: parseFloat(opts.dx), dy: parseFloat(opts.dy),
      })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Wheel (dx=${res.dx}, dy=${res.dy}) (${res.duration_ms}ms)`)
    })

  program
    .command('insert-text <session-id> <text>')
    .description('Insert text into the focused element, bypassing key events (supports emoji/CJK)')
    .action(async (sessionId, text) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/insert_text`, { text })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Inserted text (${res.length} chars, ${res.duration_ms}ms)`)
    })

  // ---------------------------------------------------------------------------
  // R07-T20 — Bounding box
  // ---------------------------------------------------------------------------

  program
    .command('bbox <session-id> <selector-or-eid>')
    .description('Return the bounding box of an element (selector or element_id)')
    .option('--element-id', 'Treat arg as element_id from element-map')
    .action(async (sessionId, target, opts) => {
      const body: Record<string, unknown> = opts.elementId ? { element_id: target } : { selector: target }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/bbox`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      if (!res.found) { console.log(`(element not found: "${target}")`); return }
      console.log(`✓ Bbox: x=${res.x} y=${res.y} w=${res.width} h=${res.height} center=(${res.center_x}, ${res.center_y}) (${res.duration_ms}ms)`)
    })

  // ---------------------------------------------------------------------------
  // R07-T22 — Dialog observability
  // ---------------------------------------------------------------------------

  program
    .command('dialogs <session-id>')
    .description('List auto-dismissed dialog history for a session')
    .option('--tail <n>', 'Last N entries')
    .option('--clear', 'Clear the dialog history buffer')
    .action(async (sessionId, opts) => {
      if (opts.clear) {
        const r = await apiDelete(`/api/v1/sessions/${sessionId}/dialogs`)
        console.log(`✓ Dialog history cleared (status ${r.statusCode})`)
        return
      }
      const qs = opts.tail ? `?tail=${opts.tail}` : ''
      const res = await apiGet(`/api/v1/sessions/${sessionId}/dialogs${qs}`)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      if (res.count === 0) { console.log('(no dialogs)'); return }
      for (const e of res.entries) {
        console.log(`[${e.ts}] ${e.type} "${e.message}" (${e.action}) url=${e.url}`)
      }
    })

  // ---------------------------------------------------------------------------
  // R07-T23 — Clipboard
  // ---------------------------------------------------------------------------

  program
    .command('clipboard-write <session-id> <text>')
    .description('Write text to the browser clipboard')
    .action(async (sessionId, text) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/clipboard`, { text })
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(`✓ Clipboard written (${res.length} chars, ${res.duration_ms}ms)`)
    })

  program
    .command('clipboard-read <session-id>')
    .description('Read text from the browser clipboard')
    .action(async (sessionId) => {
      const res = await apiGet(`/api/v1/sessions/${sessionId}/clipboard`)
      if (res.error) { printDiagnostics(res); process.exit(1) }
      console.log(res.text)
    })

  // ---------------------------------------------------------------------------
  // R07-T24 — Viewport emulation
  // ---------------------------------------------------------------------------

  program
    .command('set-viewport <session-id> <width> <height>')
    .description('Resize the page viewport to width × height pixels')
    .action(async (sessionId, width, height) => {
      const res = await apiPut(`/api/v1/sessions/${sessionId}/viewport`, {
        width: parseInt(width), height: parseInt(height),
      })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Viewport set to ${res.width}×${res.height} (${res.duration_ms}ms)`)
    })

  // ---------------------------------------------------------------------------
  // R07-T25 — Network conditions
  // ---------------------------------------------------------------------------

  program
    .command('set-network <session-id>')
    .description('Emulate network throttling or offline mode (CDP)')
    .option('--offline', 'Enable offline mode')
    .option('--latency-ms <ms>', 'Additional latency in ms', '0')
    .option('--download-kbps <kbps>', 'Download bandwidth limit (-1 = unlimited)', '-1')
    .option('--upload-kbps <kbps>', 'Upload bandwidth limit (-1 = unlimited)', '-1')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/network_conditions`, {
        offline: !!opts.offline,
        latency_ms: parseInt(opts.latencyMs),
        download_kbps: parseFloat(opts.downloadKbps),
        upload_kbps: parseFloat(opts.uploadKbps),
      })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Network: offline=${res.offline} latency=${res.latency_ms}ms down=${res.download_kbps} up=${res.upload_kbps}`)
    })

  program
    .command('reset-network <session-id>')
    .description('Reset network conditions to normal (no throttling)')
    .action(async (sessionId) => {
      const r = await apiDelete(`/api/v1/sessions/${sessionId}/network_conditions`)
      console.log(`✓ Network conditions reset (status ${r.statusCode})`)
    })
}
