/**
 * R07-C04 browser-control routes:
 *  T22 — JS dialog observability (auto-dismissed; history buffer)
 *  T23 — Clipboard read/write
 *  T24 — Viewport emulation
 *  T25 — Network condition simulation (CDP)
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
  if ('zombie' in result) { reply.code(410).send({ error: `Session ${id} is in zombie state` }); return null }
  return result as ReadySession
}

export function registerBrowserControlRoutes(server: FastifyInstance, registry: SessionRegistry): void {
  function bm(): BrowserManager { return (server as any).browserManager }
  function getLogger() { return (server as any).auditLogger }
  function inferOp(req: any, s: any, explicit?: string): string {
    if (explicit) return explicit
    const h = req.headers?.['x-operator']
    if (h) return Array.isArray(h) ? h[0] : h
    if (s.agentId) return s.agentId
    return 'agentmb-daemon'
  }

  // ─── T22: dialogs ─────────────────────────────────────────────────────────

  /** GET /sessions/:id/dialogs?tail=N — list auto-dismissed dialog history */
  server.get<{ Params: { id: string }; Querystring: { tail?: string } }>(
    '/api/v1/sessions/:id/dialogs',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      const tail = req.query.tail ? parseInt(req.query.tail) : undefined
      const entries = bm().getDialogs(s.id, tail)
      return { session_id: s.id, entries, count: entries.length }
    },
  )

  /** DELETE /sessions/:id/dialogs — clear dialog history */
  server.delete<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/dialogs',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      bm().clearDialogs(s.id)
      return { status: 'ok' }
    },
  )

  // ─── T23: clipboard ───────────────────────────────────────────────────────

  /** POST /sessions/:id/clipboard — write text to clipboard */
  server.post<{
    Params: { id: string }
    Body: { text: string; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/clipboard', async (req, reply) => {
    const s = resolve(registry, req.params.id, reply); if (!s) return
    const { text, purpose, operator } = req.body
    if (text === undefined) return reply.code(400).send({ error: 'text is required' })
    try {
      return await Actions.clipboardWrite(s.page, text, getLogger(), s.id, purpose, inferOp(req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  /** GET /sessions/:id/clipboard — read text from clipboard */
  server.get<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/clipboard',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      try {
        return await Actions.clipboardRead(s.page, getLogger(), s.id, undefined, inferOp(req, s))
      } catch (e) {
        if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
        throw e
      }
    },
  )

  // ─── T24: viewport ────────────────────────────────────────────────────────

  /** PUT /sessions/:id/viewport — resize the page viewport */
  server.put<{
    Params: { id: string }
    Body: { width: number; height: number; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/viewport', async (req, reply) => {
    const s = resolve(registry, req.params.id, reply); if (!s) return
    const { width, height, purpose, operator } = req.body
    if (!width || !height) return reply.code(400).send({ error: 'width and height are required' })
    try {
      return await Actions.setViewport(s.page, width, height, getLogger(), s.id, purpose, inferOp(req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // ─── T25: network conditions ──────────────────────────────────────────────

  /**
   * POST /sessions/:id/network_conditions — emulate network throttling / offline
   *
   * Body: { offline?, latency_ms?, download_kbps?, upload_kbps? }
   * Pass -1 for throughput fields to leave them unlimited.
   */
  server.post<{
    Params: { id: string }
    Body: { offline?: boolean; latency_ms?: number; download_kbps?: number; upload_kbps?: number }
  }>('/api/v1/sessions/:id/network_conditions', async (req, reply) => {
    const s = resolve(registry, req.params.id, reply); if (!s) return
    try {
      await bm().setNetworkConditions(s.id, req.body)
      return {
        status: 'ok',
        offline: req.body.offline ?? false,
        latency_ms: req.body.latency_ms ?? 0,
        download_kbps: req.body.download_kbps ?? null,
        upload_kbps: req.body.upload_kbps ?? null,
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  /** DELETE /sessions/:id/network_conditions — reset to normal network */
  server.delete<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/network_conditions',
    async (req, reply) => {
      const s = resolve(registry, req.params.id, reply); if (!s) return
      try {
        await bm().resetNetworkConditions(s.id)
        return { status: 'ok' }
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    },
  )
}
