import os from 'os'
import path from 'path'

export interface DaemonConfig {
  port: number
  host: string
  dataDir: string
  logLevel: string
  apiToken?: string
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
