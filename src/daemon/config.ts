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
   * Set via AGENTMB_ENCRYPTION_KEY env var.
   * If not set, sessions.json is stored as plain JSON (backward compatible).
   */
  encryptionKey?: string
  /**
   * Safety execution policy profile applied globally (r06-c02).
   * Set via AGENTMB_POLICY_PROFILE env var.
   * Values: 'safe' (default) | 'permissive' | 'disabled'
   */
  policyProfile?: string
}

export function resolveConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const dataDir =
    overrides.dataDir ??
    process.env.AGENTMB_DATA_DIR ??
    path.join(os.homedir(), '.agentmb')

  return {
    port: overrides.port ?? Number(process.env.AGENTMB_PORT ?? 19315),
    host: overrides.host ?? process.env.AGENTMB_HOST ?? '127.0.0.1',
    dataDir,
    logLevel: overrides.logLevel ?? process.env.AGENTMB_LOG_LEVEL ?? 'info',
    apiToken: overrides.apiToken ?? process.env.AGENTMB_API_TOKEN,
    encryptionKey: overrides.encryptionKey ?? process.env.AGENTMB_ENCRYPTION_KEY,
    policyProfile: overrides.policyProfile ?? process.env.AGENTMB_POLICY_PROFILE ?? 'safe',
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
