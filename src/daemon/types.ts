/**
 * Fastify instance type augmentation (T11: auditLogger type safety)
 *
 * Adds typed `auditLogger` and `browserManager` properties to FastifyInstance
 * so route handlers can access them without `(server as any)` casts.
 */
import type { AuditLogger } from '../audit/logger'
import type { BrowserManager } from '../browser/manager'

declare module 'fastify' {
  interface FastifyInstance {
    auditLogger: AuditLogger | undefined
    browserManager: BrowserManager | undefined
  }
}
