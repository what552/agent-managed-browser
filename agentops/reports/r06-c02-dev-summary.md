# r06-c02 Dev Summary — Safety Execution Policy Layer

**Branch:** `feat/r06-next`
**Date:** 2026-02-27
**Gate:** 12/12 PASS

---

## Scope

Implements a configurable **safety execution policy** for agentmb, providing per-session throttling, jitter, cooldown, retry budget, and sensitive-action guardrails — targeting social-media automation safety.

---

## Deliverables

### New files
| File | Purpose |
|---|---|
| `src/policy/types.ts` | `PolicyConfig`, `POLICY_PROFILES` (safe/permissive/disabled), `PolicyCheckResult` |
| `src/policy/engine.ts` | `PolicyEngine` — per-session per-domain state, `checkAndWait()`, `setSessionPolicy()`, `recordError()`, `extractDomain()` |
| `tests/e2e/test_policy.py` | 9 E2E tests (T-POL-01 to T-POL-09) |

### Modified files
| File | Change |
|---|---|
| `src/daemon/config.ts` | `policyProfile` field + `AGENTMB_POLICY_PROFILE` env var |
| `src/daemon/types.ts` | Added `policyEngine: PolicyEngine \| undefined` to `FastifyInstance` |
| `src/daemon/index.ts` | Create `PolicyEngine`, attach to server |
| `src/daemon/routes/sessions.ts` | `POST/GET /api/v1/sessions/:id/policy` endpoints |
| `src/daemon/routes/actions.ts` | `applyPolicy()` helper integrated into navigate, click, fill, type, press |
| `sdk/python/agentmb/models.py` | `PolicyInfo` model |
| `sdk/python/agentmb/client.py` | `Session.set_policy()` / `Session.get_policy()` (sync + async) |
| `sdk/python/agentmb/__init__.py` | Exported `PolicyInfo` |
| `src/cli/commands/actions.ts` | `policy <session-id> [profile]` CLI command |
| `scripts/verify.sh` | `AGENTMB_POLICY_PROFILE=disabled` for daemon + `policy` suite (TOTAL 12) |
| `README.md` | Safety Execution Policy documentation section |

---

## Policy Profiles

| Profile | Min interval | Jitter | Max actions/min | Sensitive actions |
|---|---|---|---|---|
| `safe` | 1500 ms | 300–800 ms | 8/min | blocked by default |
| `permissive` | 200 ms | 0–100 ms | 60/min | allowed |
| `disabled` | 0 ms | none | unlimited | allowed |

---

## Policy Check Flow

For each action (navigate, click, fill, type, press):

1. **Sensitive guard** — if `sensitive=true` and `allowSensitiveActions=false` → 403
2. **Retry budget** — if `retry=true` and retries exhausted → 403
3. **Cooldown** — if recent error cooldown active → 403
4. **Rate limit** — rolling 60s window > `maxActionsPerMinute` → 403
5. **Min interval** — enforce per-domain minimum gap (await)
6. **Jitter** — random delay in `[jitterMs[0], jitterMs[1]]` (await)
7. **Allow** — proceed

All events are written to the session audit log with `type="policy"`.

---

## API

```
GET  /api/v1/sessions/:id/policy          → PolicyInfo
POST /api/v1/sessions/:id/policy          → PolicyInfo
  body: { profile: string, allow_sensitive_actions?: boolean }

Action body additions:
  sensitive?: boolean   (click, fill, navigate, type, press)
  retry?: boolean       (navigate, click, fill, type, press)
```

### 400/403 responses
- `400` — invalid profile name
- `403` — sensitive action blocked, retry budget exhausted, or rate limit hit
  - body: `{ error: string, policy_event: "deny", domain?: string }`

---

## Test Results

```
[11/12] policy... PASS  (9 passed in 15.51s)
```

| Test | Description |
|---|---|
| T-POL-01 | GET /policy returns daemon default profile |
| T-POL-02 | POST /policy changes session profile |
| T-POL-03 | disabled profile — no throttle, navigate fast |
| T-POL-04 | safe profile blocks sensitive=true (403) |
| T-POL-05 | allow_sensitive_actions=True permits sensitive actions |
| T-POL-06 | retry budget exhaustion → 403 |
| T-POL-07 | policy deny events appear in audit logs |
| T-POL-08 | SDK PolicyInfo round-trip all fields |
| T-POL-09 | invalid profile → 400 |

---

## Notes

- CI / verify.sh runs daemon with `AGENTMB_POLICY_PROFILE=disabled` so existing test suites run at full speed (no throttle).
- Individual policy tests override to `safe` per-session; T-POL-06 retry exhaustion takes ~15s due to 1500ms min-interval.
- `extractDomain()` exported from `engine.ts` for use in action routes.
- `policyEngine` attached to `FastifyInstance` after `buildServer()` — request handlers access it at call time (not registration time), so no timing issues.
- Stale daemon detection note: verify.sh polls health and may hit an old daemon if port is already occupied. Fixed by always cleaning port before runs.
