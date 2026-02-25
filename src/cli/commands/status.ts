import http from 'http'

interface StatusOptions {
  port: string
}

export async function showStatus(opts: StatusOptions): Promise<void> {
  const port = parseInt(opts.port)
  const data = await get(`http://127.0.0.1:${port}/api/v1/status`)
  if (!data) {
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

function get(url: string): Promise<any> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(2000, () => { req.destroy(); resolve(null) })
  })
}
