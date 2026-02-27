import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { apiPost, apiGet } from '../client'

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
    .command('click <session-id> <selector>')
    .description('Click an element')
    .action(async (sessionId, selector) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/click`, { selector })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Clicked "${selector}" (${res.duration_ms}ms)`)
    })

  program
    .command('fill <session-id> <selector> <value>')
    .description('Fill a form field')
    .action(async (sessionId, selector, value) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/fill`, { selector, value })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Filled "${selector}" (${res.duration_ms}ms)`)
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
}
