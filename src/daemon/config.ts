import os from 'os'
import path from 'path'

export interface DaemonConfig {
  port: number
  host: string
  dataDir: string
  logLevel: string
  apiToken?: string
  /**
   * Optional AES-256-GCM encryption key for sessions.json.
   * Must be exactly 32 bytes encoded as base64 (44 chars) or hex (64 chars).
   * Set via OPENCLAW_ENCRYPTION_KEY env var.
   * If not set, sessions.json is stored as plain JSON (backward compatible).
   */
  encryptionKey?: string
}

export function resolveConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const dataDir =
    overrides.dataDir ??
    process.env.OPENCLAW_DATA_DIR ??
    path.join(os.homedir(), '.openclaw')

  return {
    port: overrides.port ?? Number(process.env.OPENCLAW_PORT ?? 19315),
    host: overrides.host ?? process.env.OPENCLAW_HOST ?? '127.0.0.1',
    dataDir,
    logLevel: overrides.logLevel ?? process.env.OPENCLAW_LOG_LEVEL ?? 'info',
    apiToken: overrides.apiToken ?? process.env.OPENCLAW_API_TOKEN,
    encryptionKey: overrides.encryptionKey ?? process.env.OPENCLAW_ENCRYPTION_KEY,
  }
}

export function profilesDir(config: DaemonConfig): string {
  return path.join(config.dataDir, 'profiles')
}

export function logsDir(config: DaemonConfig): string {
  return path.join(config.dataDir, 'logs')
}

export function pidFile(config: DaemonConfig): string {
  return path.join(config.dataDir, 'daemon.pid')
}
