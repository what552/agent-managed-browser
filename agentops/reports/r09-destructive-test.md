# R09 Destructive Acceptance Research Report

**Environment**: 
- **Port**: 19358
- **DataDir**: /tmp/agentmb-reviewer-2
- **Baseline SHA**: 7117abe

## 1. `--allow-dir` Path Whitelist Bypass (Security Audit)
**Finding**: **P0 Vulnerability - Symlink Traversal**
The `/api/v1/utils/ls` endpoint is vulnerable to directory traversal via symbolic links, completely bypassing the `--allow-dir` sandbox.

- **Mechanism**: The server uses `path.resolve(reqPath)` to sanitize `../` and then checks `abs.startsWith(allowed_dir)`. However, `path.resolve` only performs string manipulation; it does **not** resolve the actual physical path on disk. If an attacker (or compromised agent) creates a symlink within the allowed directory that points to `/etc` or `/`, the `startsWith` check passes, but `fs.promises.readdir` reads the target of the symlink.
- **Proof of Concept**:
  ```bash
  mkdir -p /tmp/allowed
  ln -s /etc /tmp/allowed/etc_link
  agentmb session new --ephemeral --allow-dir /tmp/allowed
  # This request succeeds and returns the contents of /etc
  curl "http://127.0.0.1:19358/api/v1/utils/ls?session_id=<sid>&path=/tmp/allowed/etc_link"
  ```
- **Remediation**: Use `fs.promises.realpath` to resolve the absolute physical path of the requested directory *before* comparing it against the `allow_dirs` whitelist.

## 2. Cross-Version SDK/Daemon Compatibility Boundaries
**Finding**: **Strict Version Coupling Required (Breaking Changes)**
Mixing different versions of the Python SDK and the Daemon leads to severe failures.
- **New SDK (v0.3.x) + Old Daemon (v0.2.x)**: 
  - **Pydantic Validation Crashes**: The v0.3.x SDK enforces stricter response models (e.g., `ScrollResult` requires `delta_x`, `delta_y`, `scrolled`). Older daemons do not return these fields, causing immediate `ValidationError` crashes in the SDK.
  - **Silent Failures**: New SDK parameters like `page_id` or `fill_strategy` are sent in the JSON body. Fastify ignores unknown fields on older daemons, meaning the agent's intent (e.g., targeting a background tab) is silently ignored, leading to unpredictable actions on the active tab.
- **Old SDK (v0.2.x) + New Daemon (v0.3.x)**:
  - Generally safer due to Pydantic ignoring extra fields returned by the new daemon, but new constraints (like click preflight validation) might reject previously valid requests.
- **Recommendation**: Enforce a strict version lock warning if the Daemon `version` from `/health` does not match the SDK `__version__`.

## 3. README vs CLI Help Ultimate Alignment (Documentation Traps)
**Finding**: **P2 Documentation Gaps**
While the `skills/agentmb/SKILL.md` is highly polished, the main `README.md` contains "documentation traps" where users relying on the CLI cheat sheet will miss critical features.
- **Missing CLI Commands**: The `## CLI Commands — Full Reference` table completely omits several newly added CLI commands:
  - `agentmb find` (Semantic locator)
  - `agentmb settings` (Session config readout)
  - `agentmb cookie-delete` (Targeted cookie removal)
  - `agentmb upload-url` (Remote file fetching)
- **Misleading API/SDK Tags**: Features like `upload_url` and semantic find are labeled as `**API/SDK — ...**` in the README, incorrectly implying they are not available via the CLI.
- **Recommendation**: Update the README CLI tables to include `find`, `settings`, `cookie-delete`, and `upload-url` to achieve true 100% parity documentation.
