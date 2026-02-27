/**
 * agentmb — social-media safety execution policy (r06-c02)
 *
 * Provides domain-level throttling, random jitter, cooldown windows, retry
 * budgets, and sensitive-action guardrails to reduce platform risk-control
 * triggering during automated browser workflows.
 */

export type PolicyProfileName = 'safe' | 'permissive' | 'disabled'

export interface PolicyConfig {
  /** Profile name used for identification and audit logs. */
  profile: PolicyProfileName

  // ---------------------------------------------------------------------------
  // Throttling
  // ---------------------------------------------------------------------------
  /** Minimum milliseconds between two successive actions on the same domain. */
  domainMinIntervalMs: number

  /** [min, max] random jitter added before every action (ms). */
  jitterMs: [number, number]

  // ---------------------------------------------------------------------------
  // Cooldown
  // ---------------------------------------------------------------------------
  /** Milliseconds to wait after a rate-limit/error response before next action. */
  cooldownAfterErrorMs: number

  // ---------------------------------------------------------------------------
  // Retry budget
  // ---------------------------------------------------------------------------
  /** Maximum number of retry attempts allowed per domain per session. */
  maxRetriesPerDomain: number

  // ---------------------------------------------------------------------------
  // Bulk rate limit
  // ---------------------------------------------------------------------------
  /** Maximum total actions per domain within a rolling 60-second window. */
  maxActionsPerMinute: number

  // ---------------------------------------------------------------------------
  // Sensitive action guardrails
  // ---------------------------------------------------------------------------
  /**
   * When false (default in 'safe'), requests with sensitive=true are denied
   * unless the session has explicitly enabled sensitive actions.
   */
  allowSensitiveActions: boolean
}

/** Built-in policy profiles. */
export const POLICY_PROFILES: Record<PolicyProfileName, PolicyConfig> = {
  /**
   * safe (default) — conservative settings for social-media automation.
   * Mimics human-pace interaction to minimise platform risk-control triggering.
   */
  safe: {
    profile: 'safe',
    domainMinIntervalMs: 1500,
    jitterMs: [300, 800],
    cooldownAfterErrorMs: 8000,
    maxRetriesPerDomain: 3,
    maxActionsPerMinute: 8,
    allowSensitiveActions: false,
  },

  /**
   * permissive — relaxed throttling for internal/test environments where
   * rate-control is not a concern.
   */
  permissive: {
    profile: 'permissive',
    domainMinIntervalMs: 200,
    jitterMs: [0, 100],
    cooldownAfterErrorMs: 1000,
    maxRetriesPerDomain: 10,
    maxActionsPerMinute: 60,
    allowSensitiveActions: true,
  },

  /**
   * disabled — no delays, no guardrails. Useful for unit/e2e tests where
   * execution speed matters and there is no risk-control exposure.
   */
  disabled: {
    profile: 'disabled',
    domainMinIntervalMs: 0,
    jitterMs: [0, 0],
    cooldownAfterErrorMs: 0,
    maxRetriesPerDomain: 999,
    maxActionsPerMinute: 9999,
    allowSensitiveActions: true,
  },
}

export type PolicyEvent = 'throttle' | 'cooldown' | 'deny' | 'retry' | 'jitter'

export interface PolicyCheckResult {
  allowed: boolean
  /** Present when allowed=false */
  reason?: string
  /** Type of policy event that triggered a wait or denial */
  policyEvent?: PolicyEvent
  /** Total milliseconds waited due to policy (jitter + throttle + cooldown) */
  waitedMs: number
}
