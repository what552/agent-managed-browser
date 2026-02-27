import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { SessionRegistry } from './session'
import { registerSessionRoutes } from './routes/sessions'
import { registerActionRoutes } from './routes/actions'
import { registerStateRoutes } from './routes/state'
import { DaemonConfig } from './config'
// T11: Fastify instance type augmentation — makes auditLogger/browserManager type-safe
import './types'

export function buildServer(config: DaemonConfig, registry: SessionRegistry): FastifyInstance {
  const server = Fastify({
    logger: {
      level: config.logLevel,
      ...(process.stdout.isTTY
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
            },
          }
        : {}),
    },
  })

  // API token authentication (optional — only enforced when AGENTMB_API_TOKEN is set)
  if (config.apiToken) {
    server.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
      // Skip auth for health check
      if (req.url === '/health') return

      const xToken = req.headers['x-api-token'] as string | undefined
      const authHeader = req.headers['authorization'] as string | undefined
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
      const provided = xToken ?? bearerToken

      if (provided !== config.apiToken) {
        reply.code(401).send({ error: 'Unauthorized — provide X-API-Token or Authorization: Bearer <token>' })
      }
    })
  }

  // Health check — always accessible (auth-exempt)
  server.get('/health', async () => {
    return {
      status: 'ok',
      version: '0.1.0',
      uptime_s: Math.floor(process.uptime()),
      sessions_active: registry.count(),
    }
  })

  server.get('/api/v1/status', async () => {
    return {
      pid: process.pid,
      uptime_s: Math.floor(process.uptime()),
      sessions: registry.list().map((s) => ({
        id: s.id,
        profile: s.profile,
        headless: s.headless,
        created_at: s.createdAt,
      })),
    }
  })

  registerSessionRoutes(server, registry)
  registerActionRoutes(server, registry)
  registerStateRoutes(server, registry)

  return server
}
