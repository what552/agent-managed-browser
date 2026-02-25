import { apiGet, cliPort } from '../client'

interface StatusOptions {
  port: string
}

export async function showStatus(opts: StatusOptions): Promise<void> {
  // CLI flag takes precedence, then env var
  const port = opts.port ? parseInt(opts.port) : cliPort()
  const data = await apiGet(`/api/v1/status`).catch(() => null)
  if (!data || data.error) {
    console.log(`openclaw daemon is NOT running on port ${port}`)
    return
  }
  console.log(`openclaw daemon RUNNING`)
  console.log(`  PID:      ${data.pid}`)
  console.log(`  Uptime:   ${data.uptime_s}s`)
  console.log(`  Sessions: ${data.sessions?.length ?? 0}`)
  if (data.sessions?.length) {
    for (const s of data.sessions) {
      console.log(`    [${s.id}] profile=${s.profile} headless=${s.headless}`)
    }
  }
}
