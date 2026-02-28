import { Command } from 'commander'
import { apiPost, apiGet, apiDelete } from '../client'

export function sessionCommands(program: Command): void {
  const sess = program.command('session').description('Manage browser sessions')

  sess
    .command('new')
    .description('Create a new browser session')
    .option('--profile <name>', 'Profile name (persistent storage)', 'default')
    .option('--headed', 'Launch in headed (visible) mode')
    .option('--accept-downloads', 'Allow the browser to save downloaded files (default: off)')
    .option('--ephemeral', 'Pure Sandbox: use temp dir, auto-cleanup on close')
    .option('--browser-channel <name>', 'Browser channel: chromium|chrome|msedge (managed mode only)')
    .option('--executable-path <path>', 'Absolute path to browser executable (managed mode only)')
    .option('--launch-mode <mode>', 'Launch mode: managed (default) | attach', 'managed')
    .option('--cdp-url <url>', 'CDP URL (required for --launch-mode attach)')
    .action(async (opts) => {
      const body: Record<string, unknown> = {
        profile: opts.profile,
        headless: !opts.headed,
        accept_downloads: opts.acceptDownloads ?? false,
      }
      if (opts.ephemeral) body.ephemeral = true
      if (opts.browserChannel) body.browser_channel = opts.browserChannel
      if (opts.executablePath) body.executable_path = opts.executablePath
      if (opts.launchMode && opts.launchMode !== 'managed') body.launch_mode = opts.launchMode
      if (opts.cdpUrl) body.cdp_url = opts.cdpUrl

      const res = await apiPost('/api/v1/sessions', body)
      if (res.error) { console.error('Error:', res.error, res.reason ?? ''); process.exit(1) }
      console.log(`Created session: ${res.session_id}`)
      console.log(`  Profile: ${res.profile}`)
      console.log(`  Headless: ${res.headless}`)
      if (res.accept_downloads) console.log(`  Downloads: enabled`)
      if (res.ephemeral) console.log(`  Mode: pure sandbox (ephemeral)`)
      if (res.browser_channel) console.log(`  Browser channel: ${res.browser_channel}`)
      if (res.launch_mode === 'attach') console.log(`  Mode: CDP attach (${res.cdp_url})`)
      if (res.warning) console.log(`  Warning: ${res.warning}`)
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
      if (result.statusCode === 423) {
        console.error(`Session ${sessionId} is sealed and cannot be deleted.`)
        process.exit(1)
      }
      if (result.statusCode === 404) {
        console.error(`Session ${sessionId} not found.`)
        process.exit(1)
      }
      console.log(`Session ${sessionId} closed.`)
    })

  sess
    .command('attach <session-id>')
    .description('Re-attach an existing session to a running browser via CDP')
    .requiredOption('--cdp-url <url>', 'CDP URL of the remote browser (http://localhost:PORT or ws://...)')
    .option('--url-contains <pattern>', 'Select page whose URL contains this string')
    .option('--title-contains <pattern>', 'Select page whose title contains this string')
    .option('--index <n>', 'Select page by index (0-based)', parseInt)
    .action(async (sessionId, opts) => {
      const body: Record<string, unknown> = { cdp_url: opts.cdpUrl }
      if (opts.urlContains) body.url_contains = opts.urlContains
      if (opts.titleContains) body.title_contains = opts.titleContains
      if (opts.index !== undefined) body.index = opts.index
      const res = await apiPost(`/api/v1/sessions/${sessionId}/attach`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`Session ${sessionId} attached to ${res.cdp_url}`)
      if (res.warning) console.log(`  Warning: ${res.warning}`)
    })

  sess
    .command('seal <session-id>')
    .description('Seal a session (blocks DELETE and destructive operations)')
    .action(async (sessionId) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/seal`, {})
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`Session ${sessionId} is now sealed.`)
    })
}
