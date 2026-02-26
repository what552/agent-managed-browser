import { Command } from 'commander'
import { apiPost, apiGet, apiDelete } from '../client'

export function sessionCommands(program: Command): void {
  const sess = program.command('session').description('Manage browser sessions')

  sess
    .command('new')
    .description('Create a new browser session')
    .option('--profile <name>', 'Profile name', 'default')
    .option('--headed', 'Launch in headed (visible) mode')
    .option('--accept-downloads', 'Allow the browser to save downloaded files (default: off)')
    .action(async (opts) => {
      const res = await apiPost('/api/v1/sessions', {
        profile: opts.profile,
        headless: !opts.headed,
        accept_downloads: opts.acceptDownloads ?? false,
      })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`Created session: ${res.session_id}`)
      console.log(`  Profile: ${res.profile}`)
      console.log(`  Headless: ${res.headless}`)
      if (res.accept_downloads) console.log(`  Downloads: enabled`)
    })

  sess
    .command('list')
    .description('List active sessions')
    .action(async () => {
      const sessions = await apiGet('/api/v1/sessions')
      if (!Array.isArray(sessions) || sessions.length === 0) {
        console.log('No active sessions.')
        return
      }
      for (const s of sessions) {
        // API v2 returns session_id/created_at; guard against old field names
        const id = s.session_id ?? s.id
        const created = s.created_at ?? s.createdAt
        console.log(`  ${id}  profile=${s.profile}  headless=${s.headless}  state=${s.state ?? 'live'}  created=${created}`)
      }
    })

  sess
    .command('rm <session-id>')
    .description('Close and remove a session')
    .action(async (sessionId) => {
      const result = await apiDelete(`/api/v1/sessions/${sessionId}`)
      if (result.statusCode === 404) {
        console.error(`Session ${sessionId} not found.`)
        process.exit(1)
      }
      console.log(`Session ${sessionId} closed.`)
    })
}
