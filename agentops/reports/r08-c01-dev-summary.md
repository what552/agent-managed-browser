# r08-c01 Dev Summary

**Branch**: `feat/r08-hardening`
**Baseline**: `f5b7bda` (r07-c04-fix)
**Scope**: R08-T01 + R08-T06

---

## Deliverables

### T01 — press / type / hover gain `--element-id` + `--ref-id`

**Problem**: `click` and `fill` accepted `--element-id` since R07-T14; `press`, `type`, `hover` did not, forcing a fallback to raw CSS selectors mid-workflow and breaking the DOM-mode contract.

**Changes**:

- **`press`**: `<selector>` → `<selector-or-eid>`, added `--element-id` + `--ref-id` options
- **`type`**: same, plus preserves `--delay-ms`
- **`hover`**: same

Audit of remaining commands — already had `--element-id`: `focus`, `check`, `uncheck`, `scroll`, `scroll-into-view`, `dblclick`.

**Server-side Body type fix**: `ref_id?: string` was missing from the TypeScript Body generic for `click`, `fill`, `type`, `press`, `hover`, `get`, `assert`. Added to all seven routes so TypeScript type-checks align with the runtime behavior of `resolveTarget`.

**Python SDK**: `type`, `press`, `hover` (sync + async) updated from positional-only `selector: str` to:
```python
def press(self, selector: Optional[str] = None, key: str = "", element_id: Optional[str] = None, ref_id: Optional[str] = None, ...) -> PressResult
```
Priority: `ref_id > element_id > selector`.

---

### T06 — `--ref-id` flag on all CLI commands that support `ref_id` at the API level

**Problem**: `snapshot-map` returns `ref_id` in format `snap_XXXXXX:eN`. Passing this as `--element-id snap_xxx:e1` constructed `[data-agentmb-eid="snap_xxx:e1"]` in the DOM, which doesn't exist (DOM attr is `data-agentmb-eid="e1"`). This made snapshot-ref mode non-functional from the CLI for click/fill/get/assert and any other action.

**Fix (Option A — server-side resolution)**: Added `--ref-id` as a boolean flag to all CLI commands that feed into `resolveTarget`. When present, the positional arg is sent as `{ref_id: "..."}` in the body, which the server resolves through the snapshot store → `[data-agentmb-eid="eN"]`.

Commands receiving `--ref-id`:
`click`, `fill`, `type`, `press`, `hover`, `dblclick`, `focus`, `check`, `uncheck`, `scroll`, `scroll-into-view`, `get`, `assert`, `bbox`

---

## Changed Files

| File | Change |
|------|--------|
| `src/daemon/routes/actions.ts` | Added `ref_id?: string` to Body types for `click`, `fill`, `type`, `press`, `hover`, `get`, `assert` routes |
| `src/cli/commands/actions.ts` | T01: `press`/`type`/`hover` signature → `<selector-or-eid>` + `--element-id` + `--ref-id`; T06: `--ref-id` added to `click`, `fill`, `dblclick`, `focus`, `check`, `uncheck`, `scroll`, `scroll-into-view`, `get`, `assert`, `bbox` |
| `sdk/python/agentmb/client.py` | `type`, `press`, `hover` (sync + async): signature updated to accept `selector?`, `element_id?`, `ref_id?` |
| `tests/e2e/test_r08c01.py` | NEW — 15 tests covering T01 (press/type/hover × element_id/ref_id/selector-regression) and T06 (click/fill/get/assert/bbox via ref_id, stale 409) |
| `scripts/verify.sh` | TOTAL 16→17, added `r08c01` suite |
| `agentops/TODO.md` | T01 + T06 → DONE; done log entries |

---

## Test Results

```
python3 -m pytest tests/e2e/test_r08c01.py -v
15 passed in 28.97s

verify.sh — 17/17 PASSED

[15/17] r07c04  PASS  (27 passed, 1 skipped in 28.91s)
[16/17] r08c01  PASS  (15 passed in 31.31s)
```

Full suite (all 17 gates):
```
smoke: 15  auth: 11  handoff: 6  cdp: 8  actions-v2: 10  pages-frames: 7
network-cdp: 8  c05-fixes: 10  policy: 11  element-map: 9
r07c02: 24  r07c03: 22  r07c04: 27 (+1 skip)  r08c01: 15
```

---

## Notes

- **Server Body types**: Fastify doesn't do runtime schema stripping for these routes (no `schema:` property defined), so `ref_id` passed in the body always flowed through to `resolveTarget` at runtime. The TypeScript fix is for type correctness only.
- **CLI `--ref-id` is a boolean flag**: Same design as `--element-id` — the positional arg carries the value, the flag signals how to interpret it. This keeps consistent UX across all commands.
- **Python SDK backward compat**: `selector` is now `Optional[str] = None` but all existing call sites pass it positionally and the behavior is unchanged. Tests pass with no modifications to existing test files.
