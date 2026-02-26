# agentmb Python SDK

Python client for the [agentmb](https://github.com/what552/agent-managed-browser) daemon — local Chromium runtime for AI agents.

## Install

```bash
pip install agentmb
```

Or from source (editable):

```bash
pip install -e sdk/python
```

## Quick start

```python
from agentmb import BrowserClient

with BrowserClient() as client:
    with client.sessions.create(profile="myprofile") as sess:
        sess.navigate("https://example.com")
        shot = sess.screenshot()
        shot.save("/tmp/out.png")
```

Async:

```python
import asyncio
from agentmb import AsyncBrowserClient

async def main():
    async with AsyncBrowserClient() as client:
        sess = await client.sessions.create(profile="demo")
        async with sess:
            await sess.navigate("https://example.com")
            result = await sess.eval("document.title")
            print(result.result)

asyncio.run(main())
```

## Action methods

| Method | Description |
|---|---|
| `sess.navigate(url)` | Navigate to URL |
| `sess.screenshot()` | Capture screenshot → `ScreenshotResult` |
| `sess.eval(expr)` | Run JS → `EvalResult` |
| `sess.extract(selector)` | Extract text/attrs → `ExtractResult` |
| `sess.click(selector)` | Click element |
| `sess.fill(selector, value)` | Fill form field |
| `sess.type(selector, text)` | Type char-by-char |
| `sess.press(selector, key)` | Press key / combo (e.g. `"Enter"`, `"Control+a"`) |
| `sess.select(selector, values)` | Select `<option>` in a `<select>` |
| `sess.hover(selector)` | Hover over element |
| `sess.wait_for_selector(selector, state)` | Wait for element visibility state |
| `sess.wait_for_url(pattern)` | Wait for URL to match glob pattern |
| `sess.wait_for_response(url_pattern, trigger)` | Wait for a network response |
| `sess.upload(selector, file_path)` | Upload file to `<input type="file">` |
| `sess.download(selector)` | Click download link → `DownloadResult` |
| `sess.handoff_start()` | Switch to headed mode for human login |
| `sess.handoff_complete()` | Return to headless after login |
| `sess.cdp_send(method, params)` | Send raw CDP command |
| `sess.logs(tail)` | Fetch audit log entries |

### File upload / download

```python
# Upload
result = sess.upload("#file-input", "/path/to/file.csv", mime_type="text/csv")
print(result.filename, result.size_bytes)

# Download: triggers click, returns base64 file content
dl = sess.download("#download-link")
dl.save("/tmp/report.pdf")
```

### Wait actions

```python
# Wait for element to appear
sess.wait_for_selector("#modal", state="visible", timeout_ms=3000)

# Wait for URL after SPA navigation
sess.wait_for_url("**/dashboard**", timeout_ms=5000)

# Wait for a specific network response (with navigate trigger)
resp = sess.wait_for_response(
    url_pattern="/api/data",
    timeout_ms=10000,
    trigger={"type": "navigate", "url": "https://app.example.com"},
)
print(resp.status_code)
```

## Requirements

- Python 3.9+
- agentmb daemon running (`agentmb start`)

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `AGENTMB_PORT` | `19315` | Daemon port |
| `AGENTMB_API_TOKEN` | (none) | API token if daemon started with one |

## License

MIT
