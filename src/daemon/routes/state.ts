/**
 * R07-C03 state routes:
 *  T05 — Cookie CRUD + storage_state export/import
 *  T06/T16/T17 — Console log + page error collection
 *  T15 — Annotated screenshot
 */
import { FastifyInstance, FastifyReply } from 'fastify'
import { SessionRegistry, LiveSession } from '../session'
import { BrowserContext, Page } from 'playwright-core'
import { BrowserManager } from '../../browser/manager'
import * as Actions from '../../browser/actions'
import { ActionDiagnosticsError } from '../../browser/actions'
import '../types'

type ReadySession = LiveSession & { context: BrowserContext; page: Page }

function resolve(registry: SessionRegistry, id: string, reply: FastifyReply): ReadySession | null {
  const result = registry.getLive(id)
  if ('notFound' in result) { reply.code(404).send({ error: `Session ${id} not found` }); return null }
  if ('zombie' in result) { reply.code(410).send({ error: `Session ${id} is in zombie state — relaunch first` }); return null }
  return result as ReadySession
}

export function registerStateRoutes(server: FastifyInstance, registry: SessionRegistry): void {
  function bm(): BrowserManager {
    return (server as any).browserManager
  }

  // ---------------------------------------------------------------------------
  // R07-T05: Cookie management
  // ---------------------------------------------------------------------------

  /** GET /api/v1/sessions/:id/cookies — list all cookies (optionally filtered by URLs) */
  server.get<{ Params: { id: string }; Querystring: { urls?: string } }>(
    '/api/v1/sessions/:id/cookies',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      const urls = req.query.urls ? req.query.urls.split(',') : undefined
      const cookies = await bm().getCookies(s.id, urls)
      return { session_id: s.id, cookies, count: cookies.length }
    },
  )

  /** POST /api/v1/sessions/:id/cookies — add cookies */
  server.post<{ Params: { id: string }; Body: { cookies: object[] } }>(
    '/api/v1/sessions/:id/cookies',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      const { cookies } = req.body
      if (!Array.isArray(cookies) || cookies.length === 0) {
        return reply.code(400).send({ error: 'cookies must be a non-empty array' })
      }
      await bm().addCookies(s.id, cookies)
      return { status: 'ok', added: cookies.length }
    },
  )

  /** DELETE /api/v1/sessions/:id/cookies — clear all cookies */
  server.delete<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/cookies',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      await bm().clearCookies(s.id)
      return { status: 'ok' }
    },
  )

  /**
   * POST /api/v1/sessions/:id/cookies/delete — delete specific cookie(s) by name (R08-R15)
   * Body: { name: string; domain?: string }
   * Gets all cookies, removes matching ones, clears, and re-adds the rest.
   */
  server.post<{ Params: { id: string }; Body: { name: string; domain?: string } }>(
    '/api/v1/sessions/:id/cookies/delete',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      const { name, domain } = req.body
      if (!name) return reply.code(400).send({ error: 'name is required' })
      const all = await bm().getCookies(s.id)
      const kept = all.filter((c: any) => {
        if (c.name !== name) return true
        if (domain && c.domain !== domain) return true
        return false
      })
      const removed = all.length - kept.length
      await bm().clearCookies(s.id)
      if (kept.length > 0) await bm().addCookies(s.id, kept)
      return { status: 'ok', removed, remaining: kept.length }
    },
  )

  // ---------------------------------------------------------------------------
  // R07-T05: Storage state (Playwright storageState format)
  // ---------------------------------------------------------------------------

  /** GET /api/v1/sessions/:id/storage_state — export full storage state */
  server.get<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/storage_state',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      const state = await bm().getStorageState(s.id)
      return { session_id: s.id, storage_state: state }
    },
  )

  /**
   * POST /api/v1/sessions/:id/storage_state — restore cookies from a
   * previously exported storage_state object. Merges into the current context.
   *
   * **Limitation:** Only `cookies` are restored.  The `origins` array
   * (localStorage / sessionStorage) cannot be injected into a Playwright
   * context after launch — use `addInitScript` or navigate to the target
   * origin and write storage via `eval` instead.  `origins_skipped` in the
   * response reports how many origin entries were silently ignored.
   */
  server.post<{ Params: { id: string }; Body: { storage_state: { cookies?: object[]; origins?: object[] } } }>(
    '/api/v1/sessions/:id/storage_state',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      const { storage_state } = req.body
      if (!storage_state) return reply.code(400).send({ error: 'storage_state is required' })
      const cookies = (storage_state.cookies ?? []) as object[]
      const originsCount = (storage_state.origins ?? []).length
      if (cookies.length > 0) {
        await bm().addCookies(s.id, cookies)
      }
      const response: Record<string, unknown> = { status: 'ok', cookies_restored: cookies.length, origins_skipped: originsCount }
      if (originsCount > 0) {
        response.note = 'localStorage/sessionStorage (origins) cannot be restored via this endpoint; navigate to the target origin and write storage via eval instead'
      }
      return response
    },
  )

  // ---------------------------------------------------------------------------
  // R07-T16: Console log collection
  // ---------------------------------------------------------------------------

  /** GET /api/v1/sessions/:id/console?tail=50 — last N console entries */
  server.get<{ Params: { id: string }; Querystring: { tail?: string; clear?: string } }>(
    '/api/v1/sessions/:id/console',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      const tail = req.query.tail ? parseInt(req.query.tail) : undefined
      const entries = bm().getConsoleLog(s.id, tail)
      if (req.query.clear === '1') bm().clearConsoleLog(s.id)
      return { session_id: s.id, entries, count: entries.length }
    },
  )

  /** DELETE /api/v1/sessions/:id/console — clear console log */
  server.delete<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/console',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      bm().clearConsoleLog(s.id)
      return { status: 'ok' }
    },
  )

  // ---------------------------------------------------------------------------
  // R07-T17: Page error collection
  // ---------------------------------------------------------------------------

  /** GET /api/v1/sessions/:id/page_errors?tail=20 — last N page errors */
  server.get<{ Params: { id: string }; Querystring: { tail?: string; clear?: string } }>(
    '/api/v1/sessions/:id/page_errors',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      const tail = req.query.tail ? parseInt(req.query.tail) : undefined
      const entries = bm().getPageErrors(s.id, tail)
      if (req.query.clear === '1') bm().clearPageErrors(s.id)
      return { session_id: s.id, entries, count: entries.length }
    },
  )

  /** DELETE /api/v1/sessions/:id/page_errors — clear page errors */
  server.delete<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/page_errors',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      bm().clearPageErrors(s.id)
      return { status: 'ok' }
    },
  )

  // ---------------------------------------------------------------------------
  // R07-T15: Annotated screenshot
  // ---------------------------------------------------------------------------

  server.post<{
    Params: { id: string }
    Body: {
      highlights: Array<{ selector: string; color?: string; label?: string }>
      format?: 'png' | 'jpeg'
      full_page?: boolean
      purpose?: string
      operator?: string
    }
  }>('/api/v1/sessions/:id/annotated_screenshot', async (req, reply) => {
    const s = resolve(registry, req.params.id, reply); if (!s) return
    const { highlights = [], format = 'png', full_page = false, purpose, operator } = req.body ?? {}
    const logger = (server as any).auditLogger
    try {
      return await Actions.annotatedScreenshot(s.page, highlights, format, full_page, logger, s.id, purpose, operator)
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })
}
