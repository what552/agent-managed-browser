import { Command } from 'commander'
import { apiPost, apiGet, apiDeleteWithBody } from '../client'

export function routeCommands(program: Command): void {
  const route = program.command('route').description('Manage network route mocks for a session')

  route
    .command('list <session-id>')
    .description('List active route mocks')
    .action(async (sessionId) => {
      const res = await apiGet(`/api/v1/sessions/${sessionId}/routes`)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      const routes = res.routes ?? []
      if (routes.length === 0) { console.log('No active route mocks.'); return }
      for (const r of routes) {
        const mock = r.mock ?? {}
        console.log(`  ${r.pattern}  →  HTTP ${mock.status ?? 200}  ${mock.content_type ?? ''}`)
      }
    })

  route
    .command('add <session-id> <pattern>')
    .description('Register a route mock (intercept requests matching pattern)')
    .option('--status <code>', 'HTTP status code', '200')
    .option('--body <text>', 'Response body text')
    .option('--content-type <type>', 'Response content-type', 'text/plain')
    .option('--headers <json>', 'Extra response headers as JSON object (e.g. \'{"X-Mock":"1"}\')')
    .action(async (sessionId, pattern, opts) => {
      const mock: Record<string, unknown> = {
        status: parseInt(opts.status),
        content_type: opts.contentType,
      }
      if (opts.body !== undefined) mock.body = opts.body
      if (opts.headers) {
        try { mock.headers = JSON.parse(opts.headers) }
        catch { console.error('Error: --headers must be valid JSON'); process.exit(1) }
      }
      const res = await apiPost(`/api/v1/sessions/${sessionId}/route`, { pattern, mock })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Route mock registered: ${res.pattern}`)
    })

  route
    .command('rm <session-id> <pattern>')
    .description('Remove a route mock by pattern')
    .action(async (sessionId, pattern) => {
      const res = await apiDeleteWithBody(`/api/v1/sessions/${sessionId}/route`, { pattern })
      if (res.statusCode === 400) { console.error('Error:', res.data?.error ?? 'Bad request'); process.exit(1) }
      if (res.statusCode === 404) { console.error('Error: Session not found.'); process.exit(1) }
      console.log(`✓ Route mock removed: ${pattern}`)
    })
}
