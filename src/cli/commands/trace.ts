import { Command } from 'commander'
import fs from 'fs'
import { apiPost } from '../client'

export function traceCommands(program: Command): void {
  const trace = program.command('trace').description('Playwright trace recording for a session')

  trace
    .command('start <session-id>')
    .description('Start trace recording (screenshots + DOM snapshots)')
    .option('--no-screenshots', 'Disable screenshot recording')
    .option('--no-snapshots', 'Disable DOM snapshot recording')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/trace/start`, {
        screenshots: opts.screenshots !== false,
        snapshots: opts.snapshots !== false,
      })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Trace recording started for session ${sessionId}`)
    })

  trace
    .command('stop <session-id>')
    .description('Stop trace recording and save the ZIP to a file')
    .option('-o, --out <file>', 'Output file path', './trace.zip')
    .action(async (sessionId, opts) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/trace/stop`, {})
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      const buf = Buffer.from(res.data, 'base64')
      fs.writeFileSync(opts.out, buf)
      console.log(`✓ Trace saved to ${opts.out} (${(buf.length / 1024).toFixed(1)}KB)`)
      console.log(`  Open with: npx playwright show-trace ${opts.out}`)
    })
}
