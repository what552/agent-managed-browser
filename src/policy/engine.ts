import crypto from 'crypto'
import type { AuditLogger } from '../audit/logger'
import {
  PolicyConfig,
  PolicyProfileName,
  POLICY_PROFILES,
  PolicyCheckResult,
  PolicyEvent,
} from './types'

/** Composite key: `${sessionId}|${domain}` */
type DomainKey = string

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function actionId(): string {
  return 'act_' + crypto.randomBytes(6).toString('hex')
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname || url
  } catch {
    // data: URIs or relative paths — use as-is, truncated
    return url.slice(0, 64)
  }
}

export class PolicyEngine {
  /** Base policy config (from daemon startup profile) */
  private baseConfig: PolicyConfig

  /** Per-session policy overrides (set by POST /sessions/:id/policy) */
  private sessionOverrides = new Map<string, PolicyConfig>()

  // -- Per-domain, per-session tracking --

  /** Timestamp of last completed action per domain-session */
  private lastActionTs = new Map<DomainKey, number>()

  /** Rolling window of action timestamps (60s) per domain-session */
  private actionWindow = new Map<DomainKey, number[]>()

  /** Retry count per domain-session */
  private retryCount = new Map<DomainKey, number>()

  /** Cooldown-ends-at timestamp per domain-session */
  private cooldownUntil = new Map<DomainKey, number>()

  /** TTL for idle domain state entries (30 minutes) */
  private static readonly DOMAIN_TTL_MS = 30 * 60_000

  /** Minimum interval between cleanup passes (5 minutes) */
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60_000

  /** Timestamp of last domain-state cleanup pass */
  private lastCleanupTs = 0

  constructor(profileName: PolicyProfileName = 'safe') {
    this.baseConfig = POLICY_PROFILES[profileName] ?? POLICY_PROFILES.safe
  }

  /**
   * Lazily prune per-domain state entries that have been idle longer than
   * DOMAIN_TTL_MS. Called from checkAndWait() at most once per
   * CLEANUP_INTERVAL_MS to avoid O(n) work on every action.
   */
  private maybeCleanupStaleDomains(): void {
    const now = Date.now()
    if (now - this.lastCleanupTs < PolicyEngine.CLEANUP_INTERVAL_MS) return
    this.lastCleanupTs = now
    for (const [key, ts] of this.lastActionTs) {
      if (now - ts > PolicyEngine.DOMAIN_TTL_MS) {
        this.lastActionTs.delete(key)
        this.actionWindow.delete(key)
        this.retryCount.delete(key)
        this.cooldownUntil.delete(key)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-session policy management
  // ---------------------------------------------------------------------------

  setSessionPolicy(sessionId: string, profileName: PolicyProfileName, overrides?: Partial<PolicyConfig>): void {
    const base = POLICY_PROFILES[profileName] ?? POLICY_PROFILES.safe
    this.sessionOverrides.set(sessionId, { ...base, ...overrides })
  }

  getSessionPolicy(sessionId: string): PolicyConfig {
    return this.sessionOverrides.get(sessionId) ?? this.baseConfig
  }

  clearSession(sessionId: string): void {
    this.sessionOverrides.delete(sessionId)
    for (const key of [...this.lastActionTs.keys()]) {
      if (key.startsWith(`${sessionId}|`)) {
        this.lastActionTs.delete(key)
        this.actionWindow.delete(key)
        this.retryCount.delete(key)
        this.cooldownUntil.delete(key)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Core check: throttle + cooldown + bulk rate-limit + jitter + guardrails
  // ---------------------------------------------------------------------------

  async checkAndWait(params: {
    sessionId: string
    domain: string
    action: string
    sensitive?: boolean
    retry?: boolean
    auditLogger?: AuditLogger
  }): Promise<PolicyCheckResult> {
    const { sessionId, domain, action, sensitive = false, retry = false, auditLogger } = params
    const cfg = this.getSessionPolicy(sessionId)
    const key: DomainKey = `${sessionId}|${domain}`
    let waitedMs = 0

    // Profile 'disabled' — fast path, no checks
    if (cfg.profile === 'disabled') {
      return { allowed: true, waitedMs: 0 }
    }

    // Lazy domain-state TTL cleanup (runs at most every 5 min)
    this.maybeCleanupStaleDomains()

    const aId = actionId()

    // -- Sensitive action guardrail --
    if (sensitive && !cfg.allowSensitiveActions) {
      auditLogger?.write({
        session_id: sessionId,
        action_id: aId,
        type: 'policy',
        action: 'deny',
        params: { domain, action, reason: 'sensitive_action_blocked' },
        result: { policy_event: 'deny', profile: cfg.profile },
      })
      return {
        allowed: false,
        reason: `Sensitive action blocked by '${cfg.profile}' policy. Enable via POST /api/v1/sessions/:id/policy with {"allow_sensitive_actions":true}.`,
        policyEvent: 'deny',
        waitedMs: 0,
      }
    }

    // -- Retry budget check --
    if (retry) {
      const used = this.retryCount.get(key) ?? 0
      if (used >= cfg.maxRetriesPerDomain) {
        auditLogger?.write({
          session_id: sessionId,
          action_id: aId,
          type: 'policy',
          action: 'deny',
          params: { domain, action, reason: 'retry_budget_exhausted', used, max: cfg.maxRetriesPerDomain },
          result: { policy_event: 'deny', profile: cfg.profile },
        })
        return {
          allowed: false,
          reason: `Retry budget exhausted for domain '${domain}' (${used}/${cfg.maxRetriesPerDomain} retries used).`,
          policyEvent: 'deny',
          waitedMs: 0,
        }
      }
      this.retryCount.set(key, used + 1)
      auditLogger?.write({
        session_id: sessionId,
        action_id: aId,
        type: 'policy',
        action: 'retry',
        params: { domain, action, retry_count: used + 1, max: cfg.maxRetriesPerDomain },
        result: { policy_event: 'retry', profile: cfg.profile },
      })
    }

    // -- Cooldown check --
    const cooldownEnd = this.cooldownUntil.get(key) ?? 0
    const now = Date.now()
    if (now < cooldownEnd) {
      const waitMs = cooldownEnd - now
      auditLogger?.write({
        session_id: sessionId,
        action_id: aId,
        type: 'policy',
        action: 'cooldown',
        params: { domain, action, wait_ms: waitMs },
        result: { policy_event: 'cooldown', profile: cfg.profile },
      })
      await sleep(waitMs)
      waitedMs += waitMs
    }

    // -- Bulk rate-limit (rolling 60s window) --
    const now2 = Date.now()
    const recent = (this.actionWindow.get(key) ?? []).filter((t) => now2 - t < 60_000)
    if (recent.length >= cfg.maxActionsPerMinute) {
      const oldestInWindow = recent[0]
      const waitMs = 60_000 - (now2 - oldestInWindow) + 100
      auditLogger?.write({
        session_id: sessionId,
        action_id: aId,
        type: 'policy',
        action: 'throttle',
        params: { domain, action, reason: 'bulk_rate_limit', wait_ms: waitMs, actions_in_window: recent.length },
        result: { policy_event: 'throttle', profile: cfg.profile },
      })
      await sleep(waitMs)
      waitedMs += waitMs
    }

    // -- Domain min-interval throttle --
    const now3 = Date.now()
    const lastT = this.lastActionTs.get(key) ?? 0
    const elapsed = now3 - lastT
    if (elapsed < cfg.domainMinIntervalMs) {
      const waitMs = cfg.domainMinIntervalMs - elapsed
      auditLogger?.write({
        session_id: sessionId,
        action_id: aId,
        type: 'policy',
        action: 'throttle',
        params: { domain, action, reason: 'min_interval', wait_ms: waitMs, elapsed_ms: elapsed },
        result: { policy_event: 'throttle', profile: cfg.profile },
      })
      await sleep(waitMs)
      waitedMs += waitMs
    }

    // -- Jitter --
    const [jMin, jMax] = cfg.jitterMs
    const jitter = jMax > jMin ? Math.round(jMin + Math.random() * (jMax - jMin)) : jMin
    if (jitter > 0) {
      await sleep(jitter)
      waitedMs += jitter
    }

    // -- Update tracking state --
    const now4 = Date.now()
    this.lastActionTs.set(key, now4)
    const updatedWindow = [...recent.filter((t) => now4 - t < 60_000), now4]
    this.actionWindow.set(key, updatedWindow)

    return { allowed: true, waitedMs, policyEvent: waitedMs > 0 ? 'throttle' : undefined }
  }

  // ---------------------------------------------------------------------------
  // Error / cooldown recording (call after an action receives a rate-limit error)
  // ---------------------------------------------------------------------------

  recordError(sessionId: string, domain: string, auditLogger?: AuditLogger): void {
    const cfg = this.getSessionPolicy(sessionId)
    if (cfg.cooldownAfterErrorMs <= 0) return
    const key: DomainKey = `${sessionId}|${domain}`
    const until = Date.now() + cfg.cooldownAfterErrorMs
    this.cooldownUntil.set(key, until)
    auditLogger?.write({
      session_id: sessionId,
      action_id: actionId(),
      type: 'policy',
      action: 'cooldown',
      params: { domain, reason: 'error_recorded', cooldown_until: new Date(until).toISOString() },
      result: { policy_event: 'cooldown', profile: cfg.profile },
    })
  }
}
