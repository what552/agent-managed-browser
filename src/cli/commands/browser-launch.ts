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
    .option('--profile <name>', 'Profile name (persistent, stored in ~/.agentmb/chrome-profiles/)')
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

      // T02: --profile uses persistent ~/.agentmb/chrome-profiles/<name>; default uses temp dir
      let userDataDir: string
      if (opts.profile) {
        userDataDir = path.join(os.homedir(), '.agentmb', 'chrome-profiles', opts.profile)
        fs.mkdirSync(userDataDir, { recursive: true })
      } else {
        userDataDir = path.join(os.tmpdir(), `agentmb-cdp-${port}`)
        fs.mkdirSync(userDataDir, { recursive: true })
      }

      // T02: SingletonLock pre-flight check — prevent launching if profile already in use
      const lockFile = path.join(userDataDir, 'SingletonLock')
      if (fs.existsSync(lockFile)) {
        try {
          const target = fs.readlinkSync(lockFile)
          const match = target.match(/-(\d+)$/)
          if (match) {
            const pid = parseInt(match[1], 10)
            try {
              process.kill(pid, 0)
              console.error(`Error: Profile '${opts.profile ?? port}' is already in use by PID ${pid}.`)
              console.error('  Stop the existing browser or use a different --profile / --port.')
              process.exit(1)
            } catch {
              // Process is dead — stale lock, clean it up
              fs.unlinkSync(lockFile)
            }
          } else {
            fs.unlinkSync(lockFile) // unexpected format, clean up
          }
        } catch {
          // readlinkSync failed (e.g. regular file or Windows) — try to remove and proceed
          try { fs.unlinkSync(lockFile) } catch { /* ignore */ }
        }
      }

      const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ]

      console.log(`Launching: ${execPath}`)
      console.log(`  Debugging port: ${port}`)
      if (opts.profile) {
        console.log(`  Profile: ${opts.profile}  (${userDataDir})`)
      } else {
        console.log(`  User data dir: ${userDataDir}`)
      }

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
      if (opts.profile) console.log(`Zone: stable  (chrome-profiles/${opts.profile})`)
      console.log(`\nConnect with:`)
      const profileFlag = opts.profile ? ` --profile ${opts.profile}` : ''
      console.log(`  agentmb session new --launch-mode attach --cdp-url ${cdpUrl}${profileFlag}`)
      console.log(`\nOr with Python SDK:`)
      const profileKw = opts.profile ? `, profile='${opts.profile}'` : ''
      console.log(`  client.sessions.create(launch_mode='attach', cdp_url='${cdpUrl}'${profileKw})`)
    })
}
