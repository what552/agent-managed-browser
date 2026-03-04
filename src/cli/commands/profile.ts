/**
 * R10-T05: profile list/delete — zone-aware profile management
 *
 * Zones:
 *   managed — Playwright-managed Chromium profiles (profiles/)
 *   stable  — Chrome/Edge native browser profiles (chrome-profiles/)
 */
import { Command } from 'commander'
import { apiGet, apiDeleteJson } from '../client'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string | null): string {
  if (!iso) return 'unknown'
  return iso.slice(0, 10) // YYYY-MM-DD
}

export function profileCommands(program: Command): void {
  const prof = program.command('profile').description('Manage browser profiles (T05)')

  prof
    .command('list')
    .description('List all profiles with zone, size, session, and modification info')
    .option('--zone <zone>', 'Filter by zone: managed | stable')
    .action(async (opts) => {
      let url = '/api/v1/profiles'
      if (opts.zone) url += `?zone=${encodeURIComponent(opts.zone)}`
      const res = await apiGet(url)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      const profiles: any[] = res.profiles ?? []
      if (profiles.length === 0) {
        console.log('No profiles found.')
        return
      }
      // Table header
      const ZONE_W = 10, NAME_W = 24, SESS_W = 10, SIZE_W = 10, DATE_W = 14
      console.log(
        'ZONE'.padEnd(ZONE_W) +
        'NAME'.padEnd(NAME_W) +
        'SESSIONS'.padEnd(SESS_W) +
        'SIZE'.padEnd(SIZE_W) +
        'LAST MODIFIED',
      )
      console.log('-'.repeat(ZONE_W + NAME_W + SESS_W + SIZE_W + DATE_W))
      for (const p of profiles) {
        const sessLabel = p.sessions_live > 0 ? `${p.sessions_live} live` : '0'
        console.log(
          String(p.zone).padEnd(ZONE_W) +
          String(p.name).padEnd(NAME_W) +
          sessLabel.padEnd(SESS_W) +
          formatBytes(p.size_bytes ?? 0).padEnd(SIZE_W) +
          formatDate(p.last_modified),
        )
      }
      console.log(`\nTotal: ${profiles.length}`)
    })

  prof
    .command('delete')
    .description('Delete a profile (fails with 423 if live sessions exist unless --force)')
    .requiredOption('--name <name>', 'Profile name to delete')
    .option('--zone <zone>', 'Zone: managed (default) | stable', 'managed')
    .option('--force', 'Delete even if live sessions are using this profile')
    .action(async (opts) => {
      const params = new URLSearchParams({ zone: opts.zone })
      if (opts.force) params.set('force', 'true')
      const res = await apiDeleteJson(`/api/v1/profiles/${encodeURIComponent(opts.name)}?${params}`)
      if (res.statusCode === 204) {
        console.log(`Profile '${opts.name}' (zone: ${opts.zone}) deleted successfully.`)
        return
      }
      if (res.statusCode === 423) {
        const ids = res.data?.session_ids?.join(', ') ?? ''
        console.error(`Error: profile '${opts.name}' is locked by live session(s): ${ids}`)
        console.error('Use --force to delete anyway.')
        process.exit(1)
      }
      if (res.statusCode === 404) {
        console.error(`Error: profile '${opts.name}' not found in zone '${opts.zone}'.`)
        process.exit(1)
      }
      console.error(`Error (${res.statusCode}):`, res.data?.error ?? 'unknown')
      process.exit(1)
    })
}
