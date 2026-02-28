/**
 * agentmb browser-launch — spawn a local Chrome/Chromium with remote debugging enabled.
 * Prints the CDP URL so you can use `agentmb session new --launch-mode attach --cdp-url <url>`.
 */
import { Command } from 'commander'
import { execSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'http'

function detectChromePath(): string | null {
  const platform = process.platform
  if (platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }
    return null
  } else if (platform === 'linux') {
    const commands = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']
    for (const cmd of commands) {
      try {
        const p = execSync(`which ${cmd}`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
        if (p) return p
      } catch { /* not found */ }
    }
    return null
  } else {
    // Windows: not auto-detected
    return null
  }
}

function waitForReady(port: number, timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    function attempt() {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        resolve(res.statusCode === 200)
      })
      req.on('error', () => {
        if (Date.now() < deadline) {
          setTimeout(attempt, 300)
        } else {
          resolve(false)
        }
      })
      req.end()
    }
    attempt()
  })
}

export function browserLaunchCommand(program: Command): void {
  program
    .command('browser-launch')
    .description('Launch a local Chrome/Chromium with remote debugging enabled and print the CDP URL')
    .option('--port <n>', 'Remote debugging port', '9222')
    .option('--executable <path>', 'Path to browser executable (auto-detected if not specified)')
    .option('--no-wait', 'Skip waiting for browser to be ready')
    .action(async (opts) => {
      const port = parseInt(opts.port, 10)
      let execPath = opts.executable ?? detectChromePath()

      if (!execPath) {
        if (process.platform === 'win32') {
          console.error('Error: Auto-detection is not supported on Windows.')
          console.error('  Hint: Pass --executable "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"')
        } else {
          console.error('Error: Could not find Chrome or Chromium. Install Chrome or pass --executable <path>.')
        }
        process.exit(1)
      }

      const userDataDir = path.join(os.tmpdir(), `agentmb-cdp-${port}`)
      fs.mkdirSync(userDataDir, { recursive: true })

      const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ]

      console.log(`Launching: ${execPath}`)
      console.log(`  Debugging port: ${port}`)
      console.log(`  User data dir: ${userDataDir}`)

      const proc = spawn(execPath, args, {
        detached: true,
        stdio: 'ignore',
      })
      proc.unref()

      if (opts.wait !== false) {
        process.stdout.write('Waiting for browser to be ready...')
        const ready = await waitForReady(port)
        if (!ready) {
          console.error('\nError: Browser did not become ready within 10 seconds.')
          process.exit(1)
        }
        console.log(' ready.')
      }

      const cdpUrl = `http://127.0.0.1:${port}`
      console.log(`\nCDP URL: ${cdpUrl}`)
      console.log(`\nConnect with:`)
      console.log(`  agentmb session new --launch-mode attach --cdp-url ${cdpUrl}`)
      console.log(`\nOr with Python SDK:`)
      console.log(`  client.sessions.create(launch_mode='attach', cdp_url='${cdpUrl}')`)
    })
}
