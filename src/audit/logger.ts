import fs from 'fs'
import path from 'path'

export interface AuditEntry {
  ts?: string
  v?: number
  session_id?: string
  action_id?: string
  type: string
  action?: string
  url?: string
  selector?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  agent?: Record<string, unknown>
  error?: string | null
}

export class AuditLogger {
  private currentDate = ''
  private stream: fs.WriteStream | null = null

  constructor(private logsDir: string) {
    fs.mkdirSync(logsDir, { recursive: true })
  }

  write(entry: AuditEntry): void {
    const now = new Date()
    const date = now.toISOString().slice(0, 10) // YYYY-MM-DD
    if (date !== this.currentDate || !this.stream) {
      this.stream?.end()
      this.currentDate = date
      this.stream = fs.createWriteStream(path.join(this.logsDir, `${date}.jsonl`), { flags: 'a' })
    }

    const record: AuditEntry = {
      ts: now.toISOString(),
      v: 1,
      ...entry,
    }
    this.stream.write(JSON.stringify(record) + '\n')
  }

  tail(sessionId: string, lines: number): AuditEntry[] {
    const date = new Date().toISOString().slice(0, 10)
    const file = path.join(this.logsDir, `${date}.jsonl`)
    if (!fs.existsSync(file)) return []

    const content = fs.readFileSync(file, 'utf8')
    const all = content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry
        } catch {
          return null
        }
      })
      .filter((e): e is AuditEntry => e !== null)
      .filter((e) => !sessionId || e.session_id === sessionId)

    return all.slice(-lines)
  }
}
