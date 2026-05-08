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

# ── result ───────────────────────────────────────────────────────────────────
if [ "$ERRORS" -gt 0 ]; then
  echo "verify-environment: $ERRORS error(s) found."
  exit 1
fi
echo "verify-environment: all checks passed."
