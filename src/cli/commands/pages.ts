import readline from 'readline'
import { Command } from 'commander'
import { apiPost, apiGet, apiDeleteWithBody } from '../client'

export function pagesCommands(program: Command): void {
  const pages = program.command('pages').description('Manage browser tabs/pages within a session')

  pages
    .command('list <session-id>')
    .description('List all open pages (tabs) in a session')
    .action(async (sessionId) => {
      const res = await apiGet(`/api/v1/sessions/${sessionId}/pages`)
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      const ps = res.pages ?? []
      if (ps.length === 0) { console.log('No pages.'); return }
      for (const p of ps) {
        const active = p.active ? ' [active]' : ''
        console.log(`  ${p.page_id}${active}  ${p.url ?? ''}`)
      }
    })

  pages
    .command('new <session-id>')
    .description('Open a new page (tab) in a session')
    .action(async (sessionId) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/pages`, {})
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`Created page: ${res.page_id}`)
    })

  pages
    .command('switch <session-id> <page-id>')
    .description('Make a page the active automation target')
    .action(async (sessionId, pageId) => {
      const res = await apiPost(`/api/v1/sessions/${sessionId}/pages/switch`, { page_id: pageId })
      if (res.error) { console.error('Error:', res.error); process.exit(1) }
      console.log(`✓ Active page: ${res.active_page_id}`)
    })

  pages
    .command('close <session-id> [page-id]')
    .description('Close a page (omit page-id to pick interactively from a numbered list)')
    .action(async (sessionId, pageId?: string) => {
      // Interactive selection when page-id is omitted
      if (!pageId) {
        const listRes = await apiGet(`/api/v1/sessions/${sessionId}/pages`)
        if (listRes.error) { console.error('Error:', listRes.error); process.exit(1) }
        const ps: Array<{ page_id: string; url?: string; active?: boolean }> = listRes.pages ?? []
        if (ps.length === 0) { console.log('No pages found.'); return }
        if (ps.length === 1) {
          console.error('Error: Cannot close the last remaining page in a session.')
          process.exit(1)
        }
        console.log(`Pages in session ${sessionId}:`)
        ps.forEach((p, i) => {
          const marker = p.active ? ' [active]' : ''
          console.log(`  ${i + 1}) ${p.page_id}${marker}  ${p.url ?? ''}`)
        })
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const answer = await new Promise<string>((resolve) => {
          rl.question('Enter page number to close (or press Enter to cancel): ', (ans) => {
            rl.close()
            resolve(ans.trim())
          })
        })
        if (!answer) { console.log('Cancelled.'); return }
        const idx = parseInt(answer, 10) - 1
        if (isNaN(idx) || idx < 0 || idx >= ps.length) {
          console.error(`Invalid selection: "${answer}". Enter a number between 1 and ${ps.length}.`)
          process.exit(1)
        }
        pageId = ps[idx].page_id
      }

      const res = await apiDeleteWithBody(`/api/v1/sessions/${sessionId}/pages/${pageId}`, {})
      if (res.statusCode === 409) { console.error('Error: Cannot close the last remaining page in a session.'); process.exit(1) }
      if (res.statusCode === 404) { console.error('Error: Page or session not found.'); process.exit(1) }
      console.log(`✓ Page ${pageId} closed.`)
    })
}
