import { Command } from 'commander'
import http from 'http'
import fs from 'fs'

function apiPost(path: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      `http://127.0.0.1:19315${path}`,
      { method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch { resolve({ raw: data }) }
        })
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function apiGet(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:19315${path}`, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch { resolve({ raw: data }) }
      })
    })
    req.on('error', reject)
  })
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
