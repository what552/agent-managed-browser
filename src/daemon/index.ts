#!/usr/bin/env node
/**
 * agentmb daemon entrypoint
 * Launched by: agentmb start  OR  node dist/daemon/index.js
 */

// Node 20 LTS minimum — checked before any imports that may fail on old runtimes
const [nodeMajor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 20) {
  process.stderr.write(
    `[agentmb] ERROR: Node.js ${process.versions.node} is not supported.\n` +
    `  Requires Node 20 LTS or higher. Install via: nvm install 20\n`,
  )
  process.exit(1)
}

import fs from 'fs'
import path from 'path'
import { buildServer } from './server'
import { SessionRegistry } from './session'
import { BrowserManager } from '../browser/manager'
import { AuditLogger } from '../audit/logger'
import { resolveConfig, pidFile, profilesDir, logsDir } from './config'
import { PolicyEngine } from '../policy/engine'
import type { PolicyProfileName } from '../policy/types'

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
      console.error(`agentmb daemon already running (PID ${existingPid}). Use 'agentmb stop' first.`)
      process.exit(1)
    } catch {
      // stale pid file — remove and continue
      fs.unlinkSync(pid)
    }
  }
  fs.writeFileSync(pid, String(process.pid))

  const registry = new SessionRegistry(config.dataDir, config.encryptionKey)
  const manager = new BrowserManager(registry, config)
  const auditLogger = new AuditLogger(logsDir(config))

  // Restore persisted session metadata (zombie state — profiles on disk, browsers not auto-relaunched)
  registry.loadPersistedSessions()
  const zombieCount = registry.list().length
  if (zombieCount > 0) {
    console.log(`[agentmb] Loaded ${zombieCount} session(s) from state file (zombie state — run 'agentmb session new' to relaunch browser)`)
  }

  const policyProfile = (config.policyProfile ?? 'safe') as PolicyProfileName
  const policyEngine = new PolicyEngine(policyProfile)

  const server = buildServer(config, registry)
  // T11: Attach dependencies — typed via src/daemon/types.ts augmentation
  server.browserManager = manager
  server.auditLogger = auditLogger
  server.policyEngine = policyEngine
  console.log(`[agentmb] Policy profile: ${policyProfile}`)

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
      `agentmb daemon listening on http://${config.host}:${config.port}`
    )
  } catch (err) {
    server.log.error(err)
    fs.unlinkSync(pid)
    process.exit(1)
  }
}

main()
