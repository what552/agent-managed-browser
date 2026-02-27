/**
 * Shared HTTP client for CLI commands.
 * Reads AGENTMB_PORT env var (default 19315) and optional AGENTMB_API_TOKEN.
 */
import http from 'http'

export function cliPort(): number {
  return parseInt(process.env.AGENTMB_PORT ?? '19315')
}

export function cliApiBase(): string {
  return `http://127.0.0.1:${cliPort()}`
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = process.env.AGENTMB_API_TOKEN
  if (token) headers['x-api-token'] = token
  return headers
}

/** Headers for requests with no body (DELETE). Omits content-type to avoid Fastify 400. */
function buildNoBodyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = process.env.AGENTMB_API_TOKEN
  if (token) headers['x-api-token'] = token
  return headers
}

export function apiPost(path: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      cliApiBase() + path,
      { method: 'POST', headers: buildHeaders() },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch { resolve({ raw: data }) }
        })
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

export function apiGet(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    // Pass URL as string + headers in options (spread of URL loses prototype getters)
    const req = http.get(
      cliApiBase() + path,
      { headers: buildHeaders() },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch { resolve({ raw: data }) }
        })
      },
    )
    req.on('error', reject)
  })
}

export function apiDelete(path: string): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      cliApiBase() + path,
      { method: 'DELETE', headers: buildNoBodyHeaders() },
      (res) => {
        res.resume()
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

export function apiPut(path: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      cliApiBase() + path,
      { method: 'PUT', headers: buildHeaders() },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch { resolve({ raw: data }) }
        })
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/** DELETE with a JSON body (e.g. for route removal that requires a pattern). */
export function apiDeleteWithBody(path: string, body: object): Promise<{ statusCode: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      cliApiBase() + path,
      { method: 'DELETE', headers: buildHeaders() },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let parsed: any = {}
          try { parsed = JSON.parse(data) } catch { parsed = {} }
          resolve({ statusCode: res.statusCode ?? 0, data: parsed })
        })
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}
