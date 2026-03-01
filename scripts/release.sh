#!/usr/bin/env bash
# =============================================================================
# agentmb — release script (T10)
# =============================================================================
# Bumps version, syncs SDK, commits, tags, and pushes to origin.
# npm and PyPI publishing are handled automatically by GitHub Actions.
#
# Usage:
#   bash scripts/release.sh patch    # 0.1.1 → 0.1.2
#   bash scripts/release.sh minor    # 0.1.1 → 0.2.0
#   bash scripts/release.sh major    # 0.2.0 → 1.0.0
#   bash scripts/release.sh 0.2.3    # explicit version
#
# After running this script:
#   1. Go to GitHub → Releases → Draft a new release from the pushed tag
#   2. GitHub Actions triggers automatically:
#      - publish-npm.yml   → publishes to npm   (requires NPM_TOKEN secret)
#      - publish-pypi.yml  → publishes to PyPI  (OIDC Trusted Publisher, no token needed)
#
# Rollback:
#   npm unpublish agentmb@<version> --force   # within 72 h of publish
#   pip install agentmb==<previous>           # install previous version
#   git tag -d v<version> && git push origin :refs/tags/v<version>
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUMP="${1:-}"
SDK_DIR="$REPO_DIR/sdk/python"

# ── Helpers ────────────────────────────────────────────────────────────────
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
die()   { red "ERROR: $*"; exit 1; }

if [[ -z "$BUMP" ]]; then
  die "Usage: $0 <patch|minor|major|X.Y.Z>"
fi

cd "$REPO_DIR"

# ── Preflight ──────────────────────────────────────────────────────────────
bold "=== agentmb release ==="
[[ -z "$(git status --porcelain)" ]] || die "Working tree is dirty. Commit or stash changes first."

# ── Build check ───────────────────────────────────────────────────────────
printf "Building TypeScript... "
npm run build > /tmp/agentmb-release-build.log 2>&1 || { red "FAIL"; cat /tmp/agentmb-release-build.log; exit 1; }
green "OK"

# ── Sync SDK version from package.json before bumping ─────────────────────
CURRENT_VERSION=$(node -p "require('./package.json').version")
bold "Current version: $CURRENT_VERSION"

# ── npm version bump ───────────────────────────────────────────────────────
printf "Bumping npm version (%s)... " "$BUMP"
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
NEW_VERSION="${NEW_VERSION#v}"
green "$NEW_VERSION"

# ── Sync Python SDK version ────────────────────────────────────────────────
printf "Syncing Python SDK version to %s... " "$NEW_VERSION"
SDK_PYPROJECT="$SDK_DIR/pyproject.toml"
SDK_INIT="$SDK_DIR/agentmb/__init__.py"
if [[ -f "$SDK_PYPROJECT" ]]; then
  sed -i.bak "s/^version = \".*\"/version = \"$NEW_VERSION\"/" "$SDK_PYPROJECT"
  rm -f "$SDK_PYPROJECT.bak"
fi
if [[ -f "$SDK_INIT" ]]; then
  sed -i.bak "s/__version__ = \".*\"/__version__ = \"$NEW_VERSION\"/" "$SDK_INIT"
  rm -f "$SDK_INIT.bak"
fi
green "OK"

# ── Commit + tag ───────────────────────────────────────────────────────────
printf "Creating release commit and tag v%s... " "$NEW_VERSION"
git add package.json "$SDK_PYPROJECT" "$SDK_INIT" 2>/dev/null || true
git commit -m "chore(release): v$NEW_VERSION"
git tag "v$NEW_VERSION"
green "OK"

# ── Push commit + tag ─────────────────────────────────────────────────────
printf "Pushing commit + tag to origin... "
git push origin HEAD "refs/tags/v$NEW_VERSION"
green "OK"

bold ""
bold "=== v$NEW_VERSION pushed — next: create GitHub Release to trigger publishing ==="
echo ""
echo "  1. Open: https://github.com/what552/agent-managed-browser/releases/new"
echo "     → Choose tag: v$NEW_VERSION → Publish release"
echo "  2. GitHub Actions will publish automatically:"
echo "     npm:   https://www.npmjs.com/package/agentmb/v/$NEW_VERSION"
echo "     PyPI:  https://pypi.org/project/agentmb/$NEW_VERSION/"
echo ""
echo "Rollback if needed:"
echo "  npm unpublish agentmb@$NEW_VERSION --force   (within 72 h)"
echo "  pip install agentmb==$CURRENT_VERSION"
echo "  git tag -d v$NEW_VERSION && git push origin :refs/tags/v$NEW_VERSION"
