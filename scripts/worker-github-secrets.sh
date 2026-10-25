#!/bin/zsh
# Copies the worker settings from .env.worker into the GitHub repository's Actions secrets, so the cloud
# worker uses the same values as this Mac. Values go straight from the file to GitHub; nothing is printed.
#   npm run worker:github-secrets
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/.env.worker"
REPO="${WORKER_DISPATCH_REPO:-peterpblends/ThinkMade}"
[[ -f "$FILE" ]] || { echo "No .env.worker. Run npm run worker:setup first."; exit 1; }
count=0
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  key="${line%%=*}"; value="${line#*=}"
  [[ "$key" == NODE_ENV || -z "$value" ]] && continue
  printf '%s' "$value" | gh secret set "$key" --repo "$REPO" --body - >/dev/null
  echo "Set $key"
  count=$((count + 1))
done < "$FILE"
echo "Copied $count settings to GitHub secrets for $REPO."
