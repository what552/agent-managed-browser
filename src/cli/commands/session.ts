import { Command } from 'commander'
import http from 'http'

function apiBase(port = 19315): string {
  return `http://127.0.0.1:${port}`
}

async function request(method: string, path: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined
    const req = http.request(
      apiBase() + path,
      { method, headers: { 'content-type': 'application/json' } },
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
    if (payload) req.write(payload)
    req.end()
  })
}

export function sessionCommands(program: Command): void {
  const sess = program.command('session').description('Manage browser sessions')

  sess
    .command('new')
    .description('Create a new browser session')
    .option('--profile <name>', 'Profile name', 'default')
    .option('--headed', 'Launch in headed (visible) mode')
    .action(async (opts) => {
      const res = await request('POST', '/api/v1/sessions', {
        profile: opts.profile,
        headless: !opts.headed,
      })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`Created session: ${res.session_id}`)
      console.log(`  Profile: ${res.profile}`)
      console.log(`  Headless: ${res.headless}`)
    })

  sess
    .command('list')
    .description('List active sessions')
    .action(async () => {
      const sessions = await request('GET', '/api/v1/sessions')
      if (!Array.isArray(sessions) || sessions.length === 0) {
        console.log('No active sessions.')
        return
      }
      for (const s of sessions) {
        console.log(`  ${s.id}  profile=${s.profile}  headless=${s.headless}  created=${s.createdAt}`)
      }
    })

  sess
    .command('rm <session-id>')
    .description('Close and remove a session')
    .action(async (sessionId) => {
      await request('DELETE', `/api/v1/sessions/${sessionId}`)
      console.log(`Session ${sessionId} closed.`)
    })
}
