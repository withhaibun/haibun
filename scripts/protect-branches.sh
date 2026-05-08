#!/usr/bin/env bash
# Apply branch protection rules to all release branches.
# Requires: gh CLI authenticated with admin rights on the repo.
# Usage: ./scripts/protect-branches.sh [owner/repo]
# If owner/repo is omitted, gh infers it from the git remote.

set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

protect() {
  local branch="$1"
  echo "Protecting $REPO @ $branch ..."
  gh api \
    --method PUT \
    "repos/${REPO}/branches/${branch}/protection" \
    --input - <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["test"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_linear_history": false
}
EOF
  echo "  done."
}

# semantic-release pushes the chore(release) commit directly via GITHUB_TOKEN.
# That token is exempt from PR requirements when restrictions.users/teams is null
# and enforce_admins is false, so no bypass actor entry is needed.

for branch in 3.x next alpha beta rc; do
  protect "$branch" || echo "  WARNING: $branch may not exist yet, skipping."
done

echo "Branch protection applied."
