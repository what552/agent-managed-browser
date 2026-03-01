# Locator Modes — Deep Reference

Three modes for targeting page elements. **Start at Priority 1, move down only if needed.**

---

## Priority Order

```
Priority 1: element-map  →  --element-id      default; works for most pages
Priority 2: CSS Selector  →  direct             when element-map labels are empty/unreliable
Priority 3: snapshot-map →  --ref-id           when you need atomicity or batch operations
Priority 4: click-at coordinates               last resort; contenteditable, canvas
```

---

## Priority 1 — element-map + --element-id

### How it works

`element-map` injects a stable `element_id` (`e1`, `e2`, …) into every interactable element on the page and returns a list with label, tag, and selector. The IDs persist until the next `element-map` call.

```bash
agentmb element-map <session-id>
agentmb element-map <session-id> --include-unlabeled   # also include icon-only elements
```

Example output:
```
e1  [button]  Submit
e2  [input]   Email address    (placeholder="Enter email")
e3  [a]       Sign in
e4  [button]  ☰               (label_source=none — icon only)
```

Pass the ID to any action:
```bash
agentmb click  <session-id> e1 --element-id
agentmb fill   <session-id> e2 "user@example.com" --element-id
agentmb get    <session-id> text e3 --element-id
agentmb assert <session-id> visible e1 --element-id
agentmb bbox   <session-id> e1 --element-id
```

### label_source Priority Chain

The `label` field is synthesized by checking sources in this order (first non-empty wins):

| Priority | Source | `label_source` value |
|---|---|---|
| 1 | `aria-label` attribute | `"aria-label"` |
| 2 | `title` attribute | `"title"` |
| 3 | `aria-labelledby` target text | `"aria-labelledby"` |
| 4 | SVG `<title>` / `<desc>` | `"svg-title"` |
| 5 | `innerText` (trimmed) | `"text"` |
| 6 | `placeholder` attribute | `"placeholder"` |
| 7 | Fallback (icon-only) | `"none"` / `"[tag @ x,y]"` |

If `label_source=none`, the element has no readable label. Add `--include-unlabeled` to get a coordinate-based `[tag @ x,y]` fallback, or switch to CSS selector (Priority 2).

### Best for
- Text-rich pages: docs, GitHub, Hacker News, dashboards
- Forms with labeled inputs
- Buttons with accessible text

---

## Priority 2 — CSS Selector

Pass a CSS selector directly — no prior scan needed.

```bash
agentmb click  <session-id> "button[data-testid=submit]"
agentmb fill   <session-id> "#email" "user@example.com"
agentmb get    <session-id> text ".product-title"
agentmb assert <session-id> visible ".modal"
```

Python SDK:
```python
sess.click(selector="button[data-testid=submit]")
sess.fill(selector="#email", value="user@example.com")
```

### Best for
- Icon-dense SPAs where `element-map` returns `label_source=none` for most elements
- Pages with stable, predictable `data-testid` or `id` attributes
- When you already know the selector (no scan needed)

### When NOT to use
- Selectors with dynamic class names like `.css-3xk7a9` — they break on re-render
- Use element-map or snapshot-map instead

---

## Priority 3 — snapshot-map + --ref-id

### How it works

`snapshot-map` captures a server-side snapshot of the page's element state with a `page_rev` counter. Each element gets a stable `ref_id` (`snap_XXXXXX:eN`). The ref is valid as long as the page has not navigated since the snapshot.

```bash
agentmb snapshot-map <session-id>
agentmb snapshot-map <session-id> --include-unlabeled
```

Example output:
```
snap_000001:e1  [button]  Login
snap_000001:e3  [input]   Username
snap_000001:e7  [a]       Forgot password?
```

Pass the ref_id to any action:
```bash
agentmb click  <session-id> snap_000001:e1 --ref-id
agentmb fill   <session-id> snap_000001:e3 "alice" --ref-id
```

Python SDK:
```python
snap = sess.snapshot_map()

# Find by label
btn = next(e for e in snap.elements if "Login" in (e.label or ""))
sess.click(ref_id=btn.ref_id)

# Or use in run_steps
sess.run_steps([
    {"action": "click", "params": {"ref_id": btn.ref_id}},
    {"action": "fill",  "params": {"ref_id": snap.elements[2].ref_id, "value": "alice"}},
])
```

### ref_id Format

```
snap_XXXXXX:eN
│             │
│             └─ element index within the snapshot
└─ 6-char snapshot ID (hex)
```

Examples: `snap_000001:e1`, `snap_a3f9c2:e15`

### page_rev — Detecting Page Changes

`page_rev` is an integer that increments on every main-frame navigation. Poll it cheaply to detect page changes without taking a full snapshot:

```bash
# HTTP
GET /api/v1/sessions/:id/page_rev
→ { "status": "ok", "session_id": "...", "page_rev": 3, "url": "https://..." }
```

```python
rev = sess.page_rev()   # PageRevResult: .page_rev, .url
```

### Stale Ref Detection and Recovery

If the page has navigated since the snapshot, using a stale `ref_id` returns:

```
HTTP 409 stale_ref
{
  "error": "stale_ref: page changed",
  "suggestions": ["call snapshot_map to get fresh ref_ids", "re-run your step with the new ref_id"]
}
```

Recovery pattern:
```python
try:
    sess.click(ref_id="snap_000001:e1")
except httpx.HTTPStatusError as e:
    if e.response.status_code == 409:
        snap = sess.snapshot_map()          # refresh
        btn = next(el for el in snap.elements if "Login" in (el.label or ""))
        sess.click(ref_id=btn.ref_id)       # retry
```

### run_steps + ref_id

In `run_steps`, each step with a stale `ref_id` returns a step-level error (not a request crash). Use `stop_on_error=False` to continue remaining steps past a single stale ref.

```python
result = sess.run_steps(steps, stop_on_error=False)
for step in result.results:
    if step.error and "stale_ref" in str(step.error):
        # handle stale ref for this specific step
```

### Best for
- Dynamic/reactive pages where element positions change
- Batch operations (`run_steps`) where you need consistent refs across all steps
- When you need to confirm an element's existence at snapshot time before acting

---

## Priority 4 — Coordinates (click-at)

Use when: `contenteditable`, canvas elements, custom components, or all other modes fail.

```bash
agentmb bbox <session-id> "#editor"
# → { "x": 100, "y": 200, "width": 400, "height": 300, "center_x": 300, "center_y": 350 }

agentmb click-at <session-id> 300 350     # absolute page coordinates
agentmb wheel    <session-id> --dx 0 --dy 300
```

Python SDK:
```python
box = sess.bbox("#editor")
sess.click_at(x=box.center_x, y=box.center_y)
```

---

## Mode Comparison Table

| Dimension | element-map | CSS Selector | snapshot-map | click-at |
|---|---|---|---|---|
| Requires prior scan | Yes | No | Yes | Requires `bbox` |
| Stable across re-render | Yes (until re-map) | Depends on selector | Until nav | Always |
| Detects stale state | No | No | Yes (409) | No |
| Works for icon-only | With `--include-unlabeled` | Yes | With `--include-unlabeled` | Yes |
| Good for run_steps | OK | OK | Best (stale detection) | Not practical |
| Token cost | Scan needed | Zero | Scan needed | Scan needed |

---

## Semantic Find (Alternative Locator)

Locate elements by Playwright semantic locators without knowing selectors. Returns `found`, `count`, `bbox`.

```python
# query_type: 'role' | 'text' | 'label' | 'placeholder' | 'alt_text'
res = sess.find(query_type="role", query="button", name="Submit")
res = sess.find(query_type="text", query="Sign in", exact=True)
res = sess.find(query_type="placeholder", query="Search…")
res = sess.find(query_type="label", query="Email address")
```

CLI:
```bash
agentmb find <session-id> role button --name "Submit"
agentmb find <session-id> text "Sign in"
agentmb find <session-id> placeholder "Search…" --json
```

Use `find` as a complement to element-map when you know the semantic intent (role, label) but not the CSS selector.
