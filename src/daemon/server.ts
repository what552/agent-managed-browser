import Fastify, { FastifyInstance } from 'fastify'
import { SessionRegistry } from './session'
import { registerSessionRoutes } from './routes/sessions'
import { registerActionRoutes } from './routes/actions'
import { DaemonConfig } from './config'

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

  // Health check — always first so smoke tests can verify daemon is up
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

  return server
}
