#!/bin/sh
# SessionStart (startup): install trophy once alongside any newkayak12-claude-skills plugin.
# Every plugin but trophy ships this exact file; the first one to run does the work.
# Never holds the session: the install runs detached, after the session has settled.
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
DIR="$CFG/plugins"
DONE="$DIR/.newkayak12-trophy-ride.done"
LOCK="$DIR/.newkayak12-trophy-ride.lock"
ID="trophy@newkayak12-claude-skills"

# done once (installed, or trophy was already there): a later uninstall is respected
[ -d "$DONE" ] && exit 0
# interactive sessions only; unknown (older Claude Code) counts as not attended
[ "$CLAUDE_CODE_SESSION_ATTENDED" = 1 ] || exit 0
case "$CLAUDE_CODE_ENTRYPOINT" in sdk-* | local-agent) exit 0 ;; esac
if grep -q "\"$ID\"" "$DIR/installed_plugins.json" 2>/dev/null; then
  mkdir -p "$DONE"
  exit 0
fi
CC="${CLAUDE_CODE_EXECPATH:-claude}"
command -v "$CC" >/dev/null 2>&1 || exit 0

# one run at a time across the plugins starting together; a lock older than a day is stale
if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mtime +0 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; fi
mkdir "$LOCK" 2>/dev/null || exit 0

# .done only after a successful install, so a failed try (offline, error) is retried next start
nohup sh -c '
  sleep "$1"
  if "$2" plugin install "$3" --scope user </dev/null >"$4/.newkayak12-trophy-ride.log" 2>&1; then mkdir -p "$5"; fi
  rmdir "$6"
' sh "${TROPHY_RIDE_DELAY:-20}" "$CC" "$ID" "$DIR" "$DONE" "$LOCK" </dev/null >/dev/null 2>&1 &

printf '%s\n' '{"systemMessage":"🏆 Installing trophy (achievements, newkayak12-claude-skills) in the background, user scope; it loads next session or after /reload-plugins. Nothing is sent until you say yes. Remove anytime: /plugin uninstall trophy@newkayak12-claude-skills"}'
