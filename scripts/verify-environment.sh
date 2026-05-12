#!/usr/bin/env bash
# Verify release prerequisites: npm credentials and CODEOWNERS policy.
# Called from the release job in ci.yml.
# Requires: NODE_AUTH_TOKEN.
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

# ── PR approval policy (CODEOWNERS) ──────────────────────────────────────────
if [ ! -f ".github/CODEOWNERS" ]; then
  echo "ERROR: .github/CODEOWNERS is missing."
  ERRORS=$((ERRORS + 1))
elif ! grep -Eq '^[[:space:]]*\*[[:space:]]+@withhaibun/admins([[:space:]]|$)' .github/CODEOWNERS; then
  echo "ERROR: .github/CODEOWNERS must include '* @withhaibun/admins'."
  ERRORS=$((ERRORS + 1))
else
  echo "PR approval policy: CODEOWNERS includes '* @withhaibun/admins': OK"
fi

# ── result ───────────────────────────────────────────────────────────────────
if [ "$ERRORS" -gt 0 ]; then
  echo "verify-environment: $ERRORS error(s) found."
  exit 1
fi
echo "verify-environment: all checks passed."
