import { Command } from 'commander'
import fs from 'fs'
import readline from 'readline'
import { apiPost, apiGet } from '../client'

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
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      const buf = Buffer.from(res.data, 'base64')
      fs.writeFileSync(opts.out, buf)
      console.log(`✓ Screenshot saved to ${opts.out} (${(buf.length / 1024).toFixed(1)}KB, ${res.duration_ms}ms)`)
    })

  program
    .command('eval <session-id> <expression>')
    .description('Evaluate JavaScript expression in browser')
    .action(async (sessionId, expression) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/eval`, { expression })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
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
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
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
}
