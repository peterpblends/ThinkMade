#!/bin/zsh
# Asks for each worker setting and writes .env.worker. Secrets are typed hidden and never shown.
# Press Enter to keep a value that's already saved, or to skip an optional one.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/.env.worker"
touch "$FILE" && chmod 600 "$FILE"

current() { grep -E "^$1=" "$FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }

ask() { # key, prompt, hidden(1/0), default
  local key=$1 prompt=$2 hidden=$3 def=${4:-} old val
  old=$(current "$key")
  [[ -n "$old" ]] && prompt="$prompt [saved; Enter to keep]"
  [[ -z "$old" && -n "$def" ]] && prompt="$prompt [Enter for $def]"
  if [[ $hidden == 1 ]]; then read -rs "val?$prompt: "; echo; else read -r "val?$prompt: "; fi
  val="${val#"${val%%[![:space:]]*}"}"; val="${val%"${val##*[![:space:]]}"}"   # trim spaces
  val="${val#\"}"; val="${val%\"}"                                         # drop pasted quotes
  [[ -z "$val" ]] && val=${old:-$def}
  typeset -g "V_$key=$val"
}

echo "ThinkMade worker settings. Paste each value and press Enter."
ask DATABASE_URL         "1. Neon connection string (postgresql://...)" 1
ask GROQ_API_KEY         "2. Groq API key" 1
ask OPENROUTER_API_KEY   "3. OpenRouter API key" 1
ask S3_ENDPOINT          "4. Backblaze endpoint" 0 "https://s3.us-east-005.backblazeb2.com"
ask S3_BUCKET            "5. Backblaze bucket name" 0
ask S3_ACCESS_KEY_ID     "6. Backblaze keyID" 0
ask S3_SECRET_ACCESS_KEY "7. Backblaze applicationKey" 1
ask RESEND_API_KEY       "8. Resend API key (optional)" 1
ask EMAIL_FROM           "9. Email sender (optional)" 0 "ThinkMade <hello@thinkmade.zicaworld.com>"

{
  echo "# Written by npm run worker:setup. Git-ignored; never commit it."
  echo "NODE_ENV=production"
  for k in DATABASE_URL GROQ_API_KEY OPENROUTER_API_KEY S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY RESEND_API_KEY EMAIL_FROM; do
    v="V_$k"; echo "$k=${(P)v}"
  done
} > "$FILE"

missing=()
for k in DATABASE_URL GROQ_API_KEY OPENROUTER_API_KEY S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  v="V_$k"; [[ -z "${(P)v}" ]] && missing+=$k
done
[[ "$V_DATABASE_URL" == postgres* ]] || [[ -z "$V_DATABASE_URL" ]] || echo "Warning: the database value doesn't start with postgresql:// — check you copied the whole string."
if (( ${#missing} )); then
  echo "Saved, but still missing: ${missing[*]}. Run npm run worker:setup again to add them."
else
  echo "Saved all settings to .env.worker. Next: npm run worker:mac -- install"
fi
