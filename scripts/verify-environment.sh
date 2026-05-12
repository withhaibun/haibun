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

# ── PR approval policy (CODEOWNERS + branch protection rules) ───────────────
GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)}"

if [ -z "$GH_TOKEN" ] || [ -z "$REPO" ]; then
  echo "ERROR: GH_TOKEN/REPO not set; cannot verify PR approval policy."
  ERRORS=$((ERRORS + 1))
else
  if [ ! -f ".github/CODEOWNERS" ]; then
    echo "ERROR: .github/CODEOWNERS is missing; cannot enforce code owner approvals."
    ERRORS=$((ERRORS + 1))
  elif ! grep -Eq '^[[:space:]]*[^#[:space:]].*@[[:alnum:]]' .github/CODEOWNERS; then
    echo "ERROR: .github/CODEOWNERS has no active owner rule entries."
    ERRORS=$((ERRORS + 1))
  else
    OWNER="${REPO%%/*}"
    REPO_NAME="${REPO##*/}"
    RULES_JSON=$(gh api graphql \
      -f query='
        query($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            branchProtectionRules(first: 100) {
              nodes {
                pattern
                requiresApprovingReviews
                requiredApprovingReviewCount
                requiresCodeOwnerReviews
              }
            }
          }
        }' \
      -F owner="$OWNER" \
      -F name="$REPO_NAME" 2>/dev/null || true)

    if [ -z "$RULES_JSON" ] || ! echo "$RULES_JSON" | jq -e '.data.repository.branchProtectionRules.nodes' >/dev/null 2>&1; then
      echo "ERROR: Unable to read branch protection rules for PR approval policy verification."
      ERRORS=$((ERRORS + 1))
    else
      RULE_COUNT=$(echo "$RULES_JSON" | jq '.data.repository.branchProtectionRules.nodes | length')
      if [ "$RULE_COUNT" -eq 0 ]; then
        echo "ERROR: No branch protection rules found; required code owner PR approval cannot be verified."
        ERRORS=$((ERRORS + 1))
      else
        NON_COMPLIANT_PATTERNS=$(echo "$RULES_JSON" | jq -r '
          .data.repository.branchProtectionRules.nodes[]
          | select(
              (.requiresApprovingReviews != true)
              or (.requiresCodeOwnerReviews != true)
              or ((.requiredApprovingReviewCount // 0) < 1)
            )
          | .pattern
        ')
        if [ -n "$NON_COMPLIANT_PATTERNS" ]; then
          echo "ERROR: PR approval policy missing required code owner review on branch protection rule patterns:"
          echo "$NON_COMPLIANT_PATTERNS" | sed 's/^/  - /'
          ERRORS=$((ERRORS + 1))
        else
          echo "PR approval policy: branch protection rules require code owner reviews with at least one approval: OK"
        fi
      fi
    fi
  fi
fi

# ── result ───────────────────────────────────────────────────────────────────
if [ "$ERRORS" -gt 0 ]; then
  echo "verify-environment: $ERRORS error(s) found."
  exit 1
fi
echo "verify-environment: all checks passed."
