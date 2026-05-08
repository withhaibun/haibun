#!/usr/bin/env bash
# Verify release prerequisites: npm credentials and branch protection.
# Called from the release job in ci.yml.
# Requires: NODE_AUTH_TOKEN, GH_TOKEN (or GITHUB_TOKEN), REPO (owner/repo).
set -euo pipefail

ERRORS=0

# ── npm token ────────────────────────────────────────────────────────────────
if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
  echo "ERROR: NODE_AUTH_TOKEN is not set."
  ERRORS=$((ERRORS + 1))
else
  echo "--- npm registry ---"
  npm config get registry
  if npm whoami 2>&1; then
    echo "npm auth: OK"
  else
    echo "ERROR: npm whoami failed — token may be expired or revoked."
    ERRORS=$((ERRORS + 1))
  fi

  echo "--- @haibun scope access ---"
  npm view @haibun/cli name 2>&1 || echo "WARNING: could not view @haibun/cli (scope may not exist yet)"
fi

# ── branch protection ────────────────────────────────────────────────────────
GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)}"

if [ -z "$GH_TOKEN" ] || [ -z "$REPO" ]; then
  echo "WARNING: GH_TOKEN/REPO not set; skipping branch protection checks."
else
  for branch in 3.x alpha beta rc; do
    STATUS=$(gh api "repos/${REPO}/branches/${branch}/protection" \
      --jq '"enabled"' 2>/dev/null || echo "missing")
    if [ "$STATUS" = '"enabled"' ] || [ "$STATUS" = "enabled" ]; then
      echo "Branch protection $branch: OK"
    else
      # Try a simpler check — if the endpoint returns any JSON the rule exists
      RESULT=$(gh api "repos/${REPO}/branches/${branch}/protection" 2>&1 || true)
      if echo "$RESULT" | grep -q "required_status_checks\|url"; then
        echo "Branch protection $branch: OK"
      elif echo "$RESULT" | grep -q "404\|Branch not found\|Not Found"; then
        echo "Branch protection $branch: branch does not exist yet (skipping)"
      else
        echo "WARNING: Branch protection not configured for $branch — run scripts/protect-branches.sh"
        ERRORS=$((ERRORS + 1))
      fi
    fi
  done
fi

# ── result ───────────────────────────────────────────────────────────────────
if [ "$ERRORS" -gt 0 ]; then
  echo "verify-environment: $ERRORS error(s) found."
  exit 1
fi
echo "verify-environment: all checks passed."
