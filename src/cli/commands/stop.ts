import fs from 'fs'
import path from 'path'

interface StopOptions {
  dataDir: string
}

export async function stopDaemon(opts: StopOptions): Promise<void> {
  const pidPath = path.join(opts.dataDir, 'daemon.pid')

  if (!fs.existsSync(pidPath)) {
    console.log('No daemon PID file found — daemon is not running.')
    return
  }

  const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim())
  if (isNaN(pid)) {
    console.error('Invalid PID file. Removing.')
    fs.unlinkSync(pidPath)
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
    console.log(`✓ Sent SIGTERM to daemon (PID ${pid})`)

    // Wait for PID file to disappear (daemon removes it on clean exit)
    let waited = 0
    while (fs.existsSync(pidPath) && waited < 5000) {
      await new Promise((r) => setTimeout(r, 200))
      waited += 200
    }
    if (fs.existsSync(pidPath)) {
      console.warn('Daemon did not exit cleanly within 5s. Sending SIGKILL…')
      try { process.kill(pid, 'SIGKILL') } catch {}
      fs.unlinkSync(pidPath)
    } else {
      console.log('✓ Daemon stopped.')
    }
  } catch (err: any) {
    if (err.code === 'ESRCH') {
      console.log('Daemon process not found (already stopped). Cleaning up PID file.')
      fs.unlinkSync(pidPath)
    } else {
      console.error('Error stopping daemon:', err.message)
      process.exit(1)
    }
  }
}
