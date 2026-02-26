# agentmb Python SDK

Python client for the [openclaw-browser](https://github.com/what552/agent-managed-browser) daemon — local Chromium runtime for AI agents.

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
