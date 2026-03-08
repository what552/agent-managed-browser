import { Command } from 'commander'
import { apiPost, apiGet, apiDelete, apiPut } from '../client'

const VALID_PERMISSIONS = [
  'camera', 'microphone', 'notifications', 'geolocation',
  'clipboard-read', 'clipboard-write', 'accelerometer', 'background-sync',
  'magnetometer', 'gyroscope', 'midi', 'payment-handler', 'persistent-storage',
]

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
    .option('--proxy <url>', 'Session-level proxy URL (e.g. http://user:pass@host:port)')
    .option('--record-video', 'Enable video recording for this session')
    .option('--allow-dir <path>', 'Allow local directory access via /utils/ls (repeatable)', (val: string, prev: string[]) => prev.concat([val]), [] as string[])
    .option('--allow-extensions', 'Enable browser extensions (default: disabled, secure-by-default)')
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
      if (opts.proxy) body.proxy_url = opts.proxy
      if (opts.recordVideo) body.record_video = true
      if (Array.isArray(opts.allowDir) && opts.allowDir.length > 0) body.allow_dirs = opts.allowDir
      if (opts.allowExtensions) body.allow_extensions = true

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
    .option('--force', 'Force delete even if session is sealed')
    .action(async (sessionId, opts) => {
      const url = opts.force
        ? `/api/v1/sessions/${sessionId}?force=true`
        : `/api/v1/sessions/${sessionId}`
      const result = await apiDelete(url)
      if (result.statusCode === 423) {
        console.error(`Session ${sessionId} is sealed and cannot be deleted. Use --force to override.`)
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

  sess
    .command('unseal <session-id>')
    .description('T06: Unseal a session (re-enables DELETE and destructive operations)')
    .action(async (sessionId) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/unseal`, {})
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`Session ${sessionId} is now unsealed.`)
    })

  // T07: grant-permission
  sess
    .command('grant-permission <session-id> [permissions...]')
    .description(`T07: Dynamically grant browser permissions to a session.\n  Supported: ${VALID_PERMISSIONS.join(', ')}`)
    .option('--origin <url>', 'Grant only for this origin URL (optional)')
    .action(async (sessionId, permissions: string[], opts) => {
      if (!permissions || permissions.length === 0) {
        console.error('Error: at least one permission is required (e.g. camera microphone)')
        process.exit(1)
      }
      const body: Record<string, unknown> = { permissions }
      if (opts.origin) body.origin = opts.origin
      const res = await apiPost(`/api/v1/sessions/${sessionId}/grant-permission`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`Granted permissions [${res.permissions?.join(', ')}] for session ${sessionId}${res.origin ? ` (origin: ${res.origin})` : ''}`)
    })

  // T03: fork — clone state from a live session into a new session
  sess
    .command('fork <session-id>')
    .description('T03: Clone cookies+localStorage from a live session into a new session')
    .option('--channel <channel>', 'Browser channel for fork: chromium (default) | chrome | msedge', 'chromium')
    .option('--profile <name>', 'Profile name for the forked session (defaults to source profile)')
    .option('--headed', 'Launch forked session in headed mode')
    .action(async (sessionId, opts) => {
      const body: Record<string, unknown> = {}
      if (opts.channel && opts.channel !== 'chromium') body.channel = opts.channel
      if (opts.profile) body.profile = opts.profile
      if (opts.headed) body.headed = true
      const res = await apiPost(`/api/v1/sessions/${sessionId}/fork`, body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`Forked session: ${res.session_id}`)
      console.log(`  Profile: ${res.profile}`)
      console.log(`  Channel: ${res.channel}`)
      console.log(`  Source:  ${res.source_session_id}`)
      console.log(`  Cookies injected: ${res.cookies_injected}`)
      console.log(`  localStorage origins pending: ${res.origins_pending}`)
      if (res.warning) console.log(`  Warning: ${res.warning}`)
      if (res.note) console.log(`  Note: ${res.note}`)
    })

  // T03: adopt — extract state from an external CDP browser, create new managed session
  sess
    .command('adopt')
    .description('T03: Extract cookies+localStorage from an external browser via CDP into a new managed session')
    .requiredOption('--cdp-url <url>', 'CDP URL of the external browser (http://localhost:PORT or ws://...)')
    .requiredOption('--profile <name>', 'Profile name for the new managed session')
    .option('--headed', 'Launch new session in headed mode')
    .action(async (opts) => {
      const body: Record<string, unknown> = {
        cdp_url: opts.cdpUrl,
        profile: opts.profile,
      }
      if (opts.headed) body.headed = true
      const res = await apiPost('/api/v1/sessions/adopt', body)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`Adopted session: ${res.session_id}`)
      console.log(`  Profile: ${res.profile}`)
      console.log(`  Channel: ${res.channel}`)
      console.log(`  Source CDP: ${res.source_cdp_url}`)
      console.log(`  Cookies injected: ${res.cookies_injected}`)
      console.log(`  localStorage origins pending: ${res.origins_pending}`)
      if (res.warning) console.log(`  Warning: ${res.warning}`)
      if (res.note) console.log(`  Note: ${res.note}`)
    })

  // T04: switch-engine — hot-swap Chromium ↔ Chrome with state transfer
  sess
    .command('switch-engine <session-id>')
    .description('T04: Switch browser engine (Chromium ↔ Chrome/Edge) while transferring cookies+localStorage')
    .requiredOption('--target-channel <channel>', 'Target browser channel: chromium|chrome|msedge')
    .option('--keep-source', 'Keep source session alive after switch (default: close source)')
    .option('--headed', 'Launch new session in headed mode')
    .action(async (sessionId, opts) => {
      const body: Record<string, unknown> = {
        target_channel: opts.targetChannel,
        keep_source: opts.keepSource ?? false,
      }
      if (opts.headed) body.headed = true
      const res = await apiPut(`/api/v1/sessions/${sessionId}/switch-engine`, body)
      if (res.error) { console.error('Error:', res.error, res.old_channel ? `(source: ${res.old_channel})` : ''); process.exit(1) }
      console.log(`Engine switched: ${res.old_channel} → ${res.new_channel}`)
      console.log(`  New session: ${res.session_id}`)
      console.log(`  Profile: ${res.profile}`)
      console.log(`  Cookies transferred: ${res.cookies_transferred}`)
      console.log(`  localStorage origins pending: ${res.origins_transferred}`)
      if (res.keep_source) console.log(`  Source session: ${res.old_session_id} (still alive)`)
      if (res.warning) console.log(`  Warning: ${res.warning}`)
    })
}
