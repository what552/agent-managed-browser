#!/usr/bin/env bash
set -euo pipefail

# One-click bootstrap for multi-agent collaboration:
# - Creates/refreshes round branches from main
# - Creates 3 worktrees (claude/codex/gemini)
# - Initializes agentops docs skeleton (if missing)
# - Builds tmux session with dedicated windows + all-open panes
#
# Usage:
#   ./scripts/agentops_bootstrap.sh --round r02 --topic hardening
#
# Optional:
#   --session agentops
#   --main main
#   --no-launch          # do not auto-run claude/codex/gemini commands
#   --no-init-docs       # do not create missing agentops docs
#   --claude-cmd claude
#   --codex-cmd codex
#   --gemini-cmd gemini

SESSION_NAME="agentops"
MAIN_BRANCH="main"
ROUND="r01"
TOPIC="mvp"
LAUNCH_AGENTS=1
INIT_DOCS=1
CLAUDE_CMD="${CLAUDE_CMD:-claude}"
CODEX_CMD="${CODEX_CMD:-codex}"
GEMINI_CMD="${GEMINI_CMD:-gemini}"

usage() {
  cat <<'EOF'
Usage: scripts/agentops_bootstrap.sh [options]

Options:
  --round <rXX>          Round name, e.g. r01, r02 (default: r01)
  --topic <topic>        Feature topic for builder branch (default: mvp)
  --session <name>       tmux session name (default: agentops)
  --main <branch>        Main integration branch (default: main)
  --no-launch            Do not auto-start claude/codex/gemini in panes
  --no-init-docs         Do not initialize missing agentops docs
  --claude-cmd <cmd>     Builder command (default: claude)
  --codex-cmd <cmd>      Reviewer command (default: codex)
  --gemini-cmd <cmd>     Reviewer command (default: gemini)
  -h, --help             Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --round) ROUND="${2:-}"; shift 2 ;;
    --topic) TOPIC="${2:-}"; shift 2 ;;
    --session) SESSION_NAME="${2:-}"; shift 2 ;;
    --main) MAIN_BRANCH="${2:-}"; shift 2 ;;
    --no-launch) LAUNCH_AGENTS=0; shift 1 ;;
    --no-init-docs) INIT_DOCS=0; shift 1 ;;
    --claude-cmd) CLAUDE_CMD="${2:-}"; shift 2 ;;
    --codex-cmd) CODEX_CMD="${2:-}"; shift 2 ;;
    --gemini-cmd) GEMINI_CMD="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

ROUND="$(echo "$ROUND" | tr '[:upper:]' '[:lower:]')"
if [[ ! "$ROUND" =~ ^r[0-9]{2}$ ]]; then
  echo "Invalid --round '$ROUND' (expected rXX, e.g. r02)."
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git not found."
  exit 1
fi
if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux not found. Please install tmux first."
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "Not inside a git repository."
  exit 1
fi
cd "$REPO_ROOT"

if ! git show-ref --verify --quiet "refs/heads/${MAIN_BRANCH}"; then
  echo "Main branch '${MAIN_BRANCH}' not found locally."
  exit 1
fi

REPO_NAME="$(basename "$REPO_ROOT")"
PARENT_DIR="$(dirname "$REPO_ROOT")"

FEAT_BRANCH="feat/${ROUND}-${TOPIC}"
CODEX_BRANCH="review/codex-${ROUND}"
GEMINI_BRANCH="review/gemini-${ROUND}"

CLAUDE_DIR="${PARENT_DIR}/${REPO_NAME}-claude"
CODEX_DIR="${PARENT_DIR}/${REPO_NAME}-codex"
GEMINI_DIR="${PARENT_DIR}/${REPO_NAME}-gemini"

ensure_branch() {
  local branch="$1"
  if ! git show-ref --verify --quiet "refs/heads/${branch}"; then
    git branch "${branch}" "${MAIN_BRANCH}"
  fi
}

ensure_worktree() {
  local path="$1"
  local branch="$2"
  if [[ -d "$path" ]]; then
    if ! git -C "$path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo "Path exists but is not a git worktree: $path"
      exit 1
    fi
    local current_branch
    current_branch="$(git -C "$path" rev-parse --abbrev-ref HEAD)"
    if [[ "$current_branch" != "$branch" ]]; then
      git -C "$path" checkout "$branch"
    fi
  else
    git worktree add "$path" "$branch"
  fi
}

init_docs_if_missing() {
  mkdir -p agentops/reports

  if [[ ! -f agentops/TASK.md ]]; then
    cat > agentops/TASK.md <<'EOF'
# TASK

## Goal
- Define round goals and acceptance criteria.

## MVP Scope
- P0 items only for current round.

## Non-goals
- Anything outside current round milestone.

## Acceptance
- Build/test/review gate pass.

## Constraints
- Time, infra, compliance, dependency limits.

## Risks
- Top technical and delivery risks.

## Milestones
- rXX-cNN (dev), rXX-bY (review), merge gate.
EOF
  fi

  if [[ ! -f agentops/CONTEXT.md ]]; then
    cat > agentops/CONTEXT.md <<'EOF'
# CONTEXT

## Tech stack
- Runtime, framework, DB, infra.

## Code standards
- Branching, commit convention, review requirements.

## Directory conventions
- src/, tests/, scripts/, agentops/reports/.

## Env var conventions
- UPPER_SNAKE_CASE; no secrets in git.

## Agent boundaries
- Builder writes features.
- Reviewers write review reports by default.
EOF
  fi

  if [[ ! -f agentops/ARCHITECTURE.md ]]; then
    cat > agentops/ARCHITECTURE.md <<'EOF'
# ARCHITECTURE

## System boundary
- Upstream inputs, core modules, downstream outputs.

## Key data flow
- request -> auth -> business -> persistence -> audit.

## NFR
- reliability, security, observability, performance.
EOF
  fi

  if [[ ! -f agentops/DECISIONS.md ]]; then
    cat > agentops/DECISIONS.md <<'EOF'
# DECISIONS

## ADR-001
- Decision:
- Why:
- Alternatives:
- Impact:
EOF
  fi

  if [[ ! -f agentops/TODO.md ]]; then
    cat > agentops/TODO.md <<'EOF'
# TODO

## Current Round
- [ ] rXX-c01
- [ ] rXX-b1

## Blockers
- None
EOF
  fi

  if [[ ! -f agentops/RULES.md ]]; then
    cat > agentops/RULES.md <<'EOF'
# RULES

## Core
1. main only for integration.
2. Builder writes; reviewers review.
3. One round, one milestone.
4. Gate first, then merge.

## Required archive gate
- Every dev batch must archive `rXX-cNN-dev-summary.md` to main.
- Every review batch must archive `rXX-bY-gate-summary.md` to main.
- Missing archive blocks next batch and merge.
EOF
  fi

  if [[ ! -f agentops/reports/codex-review.md ]]; then
    cat > agentops/reports/codex-review.md <<'EOF'
# Codex Review

- Round:
- Batch:
- Target branch:
- Target SHA:
- Verdict: Go / Conditional / No-Go
- P0:
- P1:
EOF
  fi

  if [[ ! -f agentops/reports/gemini-review.md ]]; then
    cat > agentops/reports/gemini-review.md <<'EOF'
# Gemini Review

- Round:
- Batch:
- Target branch:
- Target SHA:
- Verdict: Go / Conditional / No-Go
- P0:
- P1:
EOF
  fi
}

ensure_window() {
  local session="$1"
  local name="$2"
  local dir="$3"
  if tmux list-windows -t "$session" -F '#W' | grep -qx "$name"; then
    tmux kill-window -t "${session}:${name}"
  fi
  tmux new-window -t "${session}:" -n "$name" -c "$dir"
}

start_in_target() {
  local target="$1"
  local dir="$2"
  local cmd="$3"
  tmux send-keys -t "$target" C-c
  tmux send-keys -t "$target" "cd '$dir'" C-m
  if [[ $LAUNCH_AGENTS -eq 1 ]]; then
    if command -v "$cmd" >/dev/null 2>&1; then
      tmux send-keys -t "$target" "$cmd" C-m
    else
      tmux send-keys -t "$target" "echo '$cmd not found; staying in shell'" C-m
    fi
  fi
}

echo "[1/5] Preparing branches from ${MAIN_BRANCH}..."
ensure_branch "$FEAT_BRANCH"
ensure_branch "$CODEX_BRANCH"
ensure_branch "$GEMINI_BRANCH"

echo "[2/5] Preparing worktrees..."
ensure_worktree "$CLAUDE_DIR" "$FEAT_BRANCH"
ensure_worktree "$CODEX_DIR" "$CODEX_BRANCH"
ensure_worktree "$GEMINI_DIR" "$GEMINI_BRANCH"

if [[ $INIT_DOCS -eq 1 ]]; then
  echo "[3/5] Initializing agentops docs (missing only)..."
  init_docs_if_missing
else
  echo "[3/5] Skipping docs init (--no-init-docs)."
fi

echo "[4/5] Preparing tmux session '${SESSION_NAME}'..."
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  tmux new-session -d -s "$SESSION_NAME" -n "bootstrap" -c "$REPO_ROOT"
fi

ensure_window "$SESSION_NAME" "claude-build" "$CLAUDE_DIR"
ensure_window "$SESSION_NAME" "codex-review" "$CODEX_DIR"
ensure_window "$SESSION_NAME" "gemini-review" "$GEMINI_DIR"
ensure_window "$SESSION_NAME" "all-open" "$CLAUDE_DIR"

tmux split-window -h -t "${SESSION_NAME}:all-open" -c "$CODEX_DIR"
tmux split-window -v -t "${SESSION_NAME}:all-open.1" -c "$GEMINI_DIR"
tmux select-layout -t "${SESSION_NAME}:all-open" tiled

tmux set-option -g mouse on
tmux set-option -g prefix2 C-a

echo "[5/5] Launching agent commands in panes..."
start_in_target "${SESSION_NAME}:claude-build" "$CLAUDE_DIR" "$CLAUDE_CMD"
start_in_target "${SESSION_NAME}:codex-review" "$CODEX_DIR" "$CODEX_CMD"
start_in_target "${SESSION_NAME}:gemini-review" "$GEMINI_DIR" "$GEMINI_CMD"
start_in_target "${SESSION_NAME}:all-open.0" "$CLAUDE_DIR" "$CLAUDE_CMD"
start_in_target "${SESSION_NAME}:all-open.1" "$CODEX_DIR" "$CODEX_CMD"
start_in_target "${SESSION_NAME}:all-open.2" "$GEMINI_DIR" "$GEMINI_CMD"

tmux select-window -t "${SESSION_NAME}:all-open"

cat <<EOF

✅ AgentOps bootstrap ready

Repo:          ${REPO_ROOT}
Main branch:   ${MAIN_BRANCH}
Round:         ${ROUND}
Builder branch:${FEAT_BRANCH}
Codex branch:  ${CODEX_BRANCH}
Gemini branch: ${GEMINI_BRANCH}

Worktrees:
- ${CLAUDE_DIR}
- ${CODEX_DIR}
- ${GEMINI_DIR}

Tmux session:
- ${SESSION_NAME}
- windows: claude-build / codex-review / gemini-review / all-open

Attach:
  tmux attach -t ${SESSION_NAME}

EOF
