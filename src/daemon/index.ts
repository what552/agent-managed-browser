#!/usr/bin/env node
/**
 * openclaw-browser daemon entrypoint
 * Launched by: openclaw start  OR  node dist/daemon/index.js
 */
import fs from 'fs'
import path from 'path'
import { buildServer } from './server'
import { SessionRegistry } from './session'
import { BrowserManager } from '../browser/manager'
import { AuditLogger } from '../audit/logger'
import { resolveConfig, pidFile, profilesDir, logsDir } from './config'

async function main() {
  const config = resolveConfig()

  // Ensure data directories exist
  fs.mkdirSync(profilesDir(config), { recursive: true })
  fs.mkdirSync(logsDir(config), { recursive: true })

  // PID file — prevent double-start
  const pid = pidFile(config)
  if (fs.existsSync(pid)) {
    const existingPid = fs.readFileSync(pid, 'utf8').trim()
    try {
      process.kill(Number(existingPid), 0) // check if process alive
      console.error(`openclaw daemon already running (PID ${existingPid}). Use 'openclaw stop' first.`)
      process.exit(1)
    } catch {
      // stale pid file — remove and continue
      fs.unlinkSync(pid)
    }
  }
  fs.writeFileSync(pid, String(process.pid))

  const registry = new SessionRegistry(config.dataDir)
  const manager = new BrowserManager(registry, config)
  const auditLogger = new AuditLogger(logsDir(config))

  // Restore persisted session metadata (zombie state — profiles on disk, browsers not auto-relaunched)
  registry.loadPersistedSessions()
  const zombieCount = registry.list().length
  if (zombieCount > 0) {
    console.log(`[openclaw] Loaded ${zombieCount} session(s) from state file (zombie state — run 'openclaw session new' to relaunch browser)`)
  }

  const server = buildServer(config, registry)
  // Attach dependencies via decoration for route handlers
  ;(server as any).browserManager = manager
  ;(server as any).auditLogger = auditLogger

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down…`)
    // Persist zombie session state BEFORE closing browsers so metadata survives restart
    await registry.shutdownAll()
    await server.close()
    fs.unlinkSync(pid)
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  try {
    await server.listen({ port: config.port, host: config.host })
    server.log.info(
      `openclaw-browser daemon listening on http://${config.host}:${config.port}`
    )
  } catch (err) {
    server.log.error(err)
    fs.unlinkSync(pid)
    process.exit(1)
  }
}

main()
