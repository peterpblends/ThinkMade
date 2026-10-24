#!/bin/zsh
# Runs the ThinkMade podcast worker on this Mac as a background service (free, no card).
#   npm run worker:mac -- install     start now and at every login; restarts if it stops
#   npm run worker:mac -- status      is it running, and the last log lines
#   npm run worker:mac -- uninstall   stop and remove the service
# Settings come from .env.worker (copy .env.worker.example). Jobs wait in the queue while the Mac is
# off or asleep and run when it wakes; caffeinate keeps it awake while plugged in and running.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.thinkmade.worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$ROOT/.data/worker.log"
NODE_DIR="$(dirname "$(command -v node)")"

case "${1:-status}" in
  install)
    [[ -f "$ROOT/.env.worker" ]] || { echo "Create $ROOT/.env.worker first (copy .env.worker.example and fill it in)."; exit 1; }
    grep -q '^DATABASE_URL=..' "$ROOT/.env.worker" || { echo ".env.worker has no DATABASE_URL."; exit 1; }
    mkdir -p "$ROOT/.data" "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-is</string>
    <string>$ROOT/node_modules/.bin/tsx</string><string>--env-file=$ROOT/.env.worker</string>
    <string>$ROOT/apps/worker/src/main.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>MODEL_CACHE_DIR</key><string>$ROOT/.data/models</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed. The worker is starting; follow it with: tail -f $LOG"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed the worker service."
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      launchctl print "gui/$(id -u)/$LABEL" | grep -E '^\s+(state|pid|last exit code)' || true
    else
      echo "Not installed."
    fi
    [[ -f "$LOG" ]] && tail -n 15 "$LOG"
    ;;
  *) echo "Usage: npm run worker:mac -- install|status|uninstall"; exit 1 ;;
esac
