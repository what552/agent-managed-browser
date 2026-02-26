import { spawn } from 'child_process'
import path from 'path'
import http from 'http'

interface StartOptions {
  port: string
  dataDir: string
  logLevel: string
}

export async function startDaemon(opts: StartOptions): Promise<void> {
  const port = parseInt(opts.port)
  const env = {
    ...process.env,
    AGENTMB_PORT: String(port),
    AGENTMB_DATA_DIR: opts.dataDir,
    AGENTMB_LOG_LEVEL: opts.logLevel,
  }

  // Check if already running
  const running = await isRunning(port)
  if (running) {
    console.log(`agentmb daemon already running on port ${port}`)
    return
  }

  const daemonEntry = path.join(__dirname, '../../daemon/index.js')

  const child = spawn(process.execPath, [daemonEntry], {
    env,
    detached: true,
    stdio: 'inherit',
  })

  child.unref()
  console.log(`agentmb daemon starting on port ${port} (PID ${child.pid})…`)

  // Wait up to 5s for daemon to become ready
  const ready = await waitReady(port, 5000)
  if (ready) {
    console.log(`✓ agentmb daemon ready — http://127.0.0.1:${port}`)
  } else {
    console.error('✗ Daemon did not become ready within 5 seconds. Check logs.')
    process.exit(1)
  }
}

function isRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(500, () => { req.destroy(); resolve(false) })
  })
}

function waitReady(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      isRunning(port).then((ok) => {
        if (ok) return resolve(true)
        if (Date.now() >= deadline) return resolve(false)
        setTimeout(check, 300)
      })
    }
    setTimeout(check, 500) // give daemon a moment to bind
  })
}
