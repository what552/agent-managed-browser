# R08-c04 Re-review @ddfb597 (19358)

**Environment**: 
- **Port**: 19358
- **DataDir**: /tmp/agentmb-gemini
- **Daemon Status**: Running (PID 91141), **STALE** (started before r08-c02/c03/c04 merge)

## Test Execution Summary
- **Command**: `AGENTMB_PORT=19358 AGENTMB_DATA_DIR=/tmp/agentmb-gemini bash scripts/verify.sh`
- **Overall Status**: **FAIL** (17/20 passed; `r08c02`, `r08c03`, `r08c04` failed)

## Findings

### P0: Environment/Daemon Stale Code (Blocker)
The pre-started daemon is running code from before r08-c02. Consequently, all server-side logic introduced in r08-c02, r08-c03, and r08-c04 is inactive in the live environment. This prevents functional verification of:
- **Scroll Observability** (r08-c02)
- **Label Synthesis** (r08-c03)
- **Drag with ref_id** (r08-c04)
- **Click/Fill Diagnostics** (r08-c02)

### P0: Mouse/Drag Regression (r08-c04)
The test `TestDrag.test_drag_with_source_ref_id` failed with **400 Bad Request**. 
- **Reason**: The SDK sent `source_ref_id` and `target_ref_id`, but the stale server (which only expects `source` and `target`) rejected the unknown fields.
- **Verification**: Code in `src/daemon/routes/actions.ts` (merged state) correctly defines these fields, but the running process is not using it.

### P1: CLI/API/SDK/README Consistency
- **README**: Significantly improved. Includes locator mode selection guides, `--include-unlabeled` tips, and explicit mention of automatic MIME inference for uploads.
- **SDK**: Python methods for `scroll` and `drag` are correctly updated to match the (intended) server API.
- **CLI**: `scroll` and `drag` command help text and options are aligned.

## Go/No-Go Recommendation
**No-Go**

**Reasoning**:
1. **Verifiability**: The core features of r08-c02 through r08-c04 cannot be verified in the required environment due to stale daemon code.
2. **Breaking Changes**: The update to the SDK's `drag` method (using `ref_id` fields) is a breaking change that is incompatible with the currently running server, as evidenced by the 400 error.
3. **Persisting Regressions**: All previously reported P0 regressions (ScrollResult validation, Click 500 error) remain active.
