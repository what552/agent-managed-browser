/**
 * R07-C04 interaction routes:
 *  T19 — click_at / wheel / insert_text (coordinate-based primitives)
 *  T20 — bbox (ref→bbox→input pipeline)
 *  T21 — dual-track click/fill (DOM fallback → coordinate fallback)
 */
import { FastifyInstance, FastifyReply } from 'fastify'
import { SessionRegistry, LiveSession } from '../session'
import { BrowserContext, Page } from 'playwright-core'
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

function getLogger(server: FastifyInstance) {
  return (server as any).auditLogger
}

function inferOp(server: FastifyInstance, req: any, s: any, explicit?: string): string {
  if (explicit) return explicit
  const header = req.headers?.['x-operator']
  if (header) return Array.isArray(header) ? header[0] : header
  if (s.agentId) return s.agentId
  return 'agentmb-daemon'
}

export function registerInteractionRoutes(server: FastifyInstance, registry: SessionRegistry): void {

  // ─── T19: click_at ────────────────────────────────────────────────────────
  server.post<{
    Params: { id: string }
    Body: { x: number; y: number; button?: 'left' | 'right' | 'middle'; click_count?: number; delay_ms?: number; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/click_at', async (req, reply) => {
    const s = resolve(registry, req.params.id, reply); if (!s) return
    const { x, y, button, click_count, delay_ms, purpose, operator } = req.body
    if (x === undefined || y === undefined) return reply.code(400).send({ error: 'x and y are required' })
    try {
      return await Actions.clickAt(s.page, x, y, { button, click_count, delay_ms }, getLogger(server), s.id, purpose, inferOp(server, req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // ─── T19: wheel (coordinate-based scroll wheel) ───────────────────────────
  server.post<{
    Params: { id: string }
    Body: { dx?: number; dy?: number; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/wheel', async (req, reply) => {
    const s = resolve(registry, req.params.id, reply); if (!s) return
    const { dx = 0, dy = 0, purpose, operator } = req.body
    try {
      return await Actions.wheelAt(s.page, dx, dy, getLogger(server), s.id, purpose, inferOp(server, req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // ─── T19: insert_text (keyboard.insertText, bypasses key events) ──────────
  server.post<{
    Params: { id: string }
    Body: { text: string; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/insert_text', async (req, reply) => {
    const s = resolve(registry, req.params.id, reply); if (!s) return
    const { text, purpose, operator } = req.body
    if (!text) return reply.code(400).send({ error: 'text is required' })
    try {
      return await Actions.insertText(s.page, text, getLogger(server), s.id, purpose, inferOp(server, req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })

  // ─── T20: bbox (bounding box via selector / element_id / ref_id) ──────────
  server.post<{
    Params: { id: string }
    Body: { selector?: string; element_id?: string; ref_id?: string; purpose?: string; operator?: string }
  }>('/api/v1/sessions/:id/bbox', async (req, reply) => {
    const s = resolve(registry, req.params.id, reply); if (!s) return
    const { selector, element_id, ref_id, purpose, operator } = req.body

    // Resolve the selector (mirrors actions.ts resolveTarget logic)
    let resolved: string | null = null
    if (selector) {
      resolved = selector
    } else if (element_id) {
      resolved = `[data-agentmb-eid="${element_id}"]`
    } else if (ref_id) {
      // Validate ref_id against snapshot store
      const bm: any = (server as any).browserManager
      const snaps: Map<string, any> = bm?.sessionSnapshots?.get(s.id)
      if (!snaps) return reply.code(404).send({ error: 'No snapshot found for session' })
      const snapId = ref_id.split(':')[0]
      const snap = snaps.get(snapId)
      if (!snap) return reply.code(404).send({ error: `Snapshot ${snapId} not found` })
      // Check page_rev
      const currentRev = bm?.sessionPageRevs?.get(s.id) ?? 0
      if (snap.page_rev !== currentRev) {
        return reply.code(409).send({ error: 'stale_ref', ref_id, page_rev: snap.page_rev, current_rev: currentRev })
      }
      const elemIdx = parseInt(ref_id.split(':e')[1] ?? '-1')
      const elem = snap.elements?.[elemIdx]
      if (!elem) return reply.code(404).send({ error: `Element index ${elemIdx} not found in snapshot` })
      resolved = elem.selector ?? `[data-agentmb-eid="${elem.element_id}"]`
    } else {
      return reply.code(400).send({ error: 'selector, element_id, or ref_id is required' })
    }

    try {
      return await Actions.getBbox(s.page, resolved as string, getLogger(server), s.id, purpose, inferOp(server, req, s, operator))
    } catch (e) {
      if (e instanceof ActionDiagnosticsError) return reply.code(422).send(e.diagnostics)
      throw e
    }
  })
}
