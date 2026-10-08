#!/bin/bash
# Tests for <plugin>/hooks/ensure-trophy.sh (the trophy ride-along hook) and its wiring in every plugin.
# usage: bash _repo/scripts/test-ensure-trophy.sh   (from the repo root)
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HOOK="$ROOT/think/hooks/ensure-trophy.sh"
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
# fake claude: logs its args, sleeps $FAKE_SLEEP, exits $FAKE_EXIT
cat > "$T/fakecc" <<'EOF'
#!/bin/sh
echo "$*" >> "$FAKE_LOG"
sleep "${FAKE_SLEEP:-0}"
exit "${FAKE_EXIT:-0}"
EOF
chmod +x "$T/fakecc"

fresh() { # new config dir; $1 = installed_plugins.json content
  CFG="$T/cfg$RANDOM$RANDOM"; mkdir -p "$CFG/plugins"
  printf '%s' "${1:-{\"version\":2,\"plugins\":{}\}}" > "$CFG/plugins/installed_plugins.json"
  LOG="$CFG/calls.log"; : > "$LOG"
}
run() { # env overrides as args; prints stdout of the hook
  env -i PATH="$PATH" HOME="$T" CLAUDE_CONFIG_DIR="$CFG" CLAUDE_CODE_EXECPATH="$T/fakecc" FAKE_LOG="$LOG" \
    TROPHY_RIDE_DELAY=0 CLAUDE_CODE_SESSION_ATTENDED=1 CLAUDE_CODE_ENTRYPOINT=cli "$@" sh "$HOOK"
}
settle() { for _ in $(seq 1 50); do [ -d "$CFG/plugins/.newkayak12-trophy-ride.lock" ] || return 0; sleep 0.1; done; }
calls() { grep -c . "$LOG" 2>/dev/null || true; }
DONE_P() { echo "$CFG/plugins/.newkayak12-trophy-ride.done"; }

# 1. wiring: byte-identical copies, SessionStart startup hook with a timeout, trophy has none
plugins=$(python3 -c "import json;print(' '.join(p['name'] for p in json.load(open('$ROOT/.claude-plugin/marketplace.json'))['plugins'] if p['name']!='trophy'))")
for p in $plugins; do
  check "$p ships an identical ensure-trophy.sh" "cmp -s '$HOOK' '$ROOT/$p/hooks/ensure-trophy.sh'"
  check "$p hooks.json runs it on SessionStart startup with a timeout" "python3 - '$ROOT/$p/hooks/hooks.json' <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
ok=any(e.get('matcher')=='startup' and any(h.get('args')==['\${CLAUDE_PLUGIN_ROOT}/hooks/ensure-trophy.sh'] and h.get('command')=='sh' and isinstance(h.get('timeout'),int) for h in e.get('hooks',[])) for e in d.get('hooks',{}).get('SessionStart',[]))
sys.exit(0 if ok else 1)
PY"
done
check "trophy ships no ride-along hook" "[ ! -e '$ROOT/trophy/hooks/ensure-trophy.sh' ]"

# 2a. trophy already installed -> no install, .done
fresh '{"version":2,"plugins":{"trophy@newkayak12-claude-skills":[{"scope":"local"}]}}'
out=$(run); settle
check "a: trophy listed -> no install" "[ \"\$(calls)\" = 0 ]"
check "a: trophy listed -> .done (a later uninstall is respected)" "[ -d \"\$(DONE_P)\" ]"
check "a: trophy listed -> no output" "[ -z \"\$out\" ]"

# 2b. .done present -> nothing
fresh; mkdir -p "$(DONE_P)"
out=$(run); settle
check "b: .done -> no install, no output" "[ \"\$(calls)\" = 0 ] && [ -z \"\$out\" ]"

# 2c. headless / unattended / unknown -> nothing, no marker
for case in "CLAUDE_CODE_SESSION_ATTENDED=0" "CLAUDE_CODE_SESSION_ATTENDED=" "CLAUDE_CODE_ENTRYPOINT=sdk-cli" "CLAUDE_CODE_ENTRYPOINT=local-agent"; do
  fresh; out=$(run "$case"); settle
  check "c: $case -> no install, no marker, no output" "[ \"\$(calls)\" = 0 ] && [ ! -e \"\$(DONE_P)\" ] && [ ! -e '$CFG/plugins/.newkayak12-trophy-ride.lock' ] && [ -z \"\$out\" ]"
done

# 2d. attended + absent -> one install with the exact args, .done after exit 0, systemMessage
fresh; out=$(run); settle
check "d: one install call" "[ \"\$(calls)\" = 1 ]"
check "d: exact args" "[ \"\$(cat \"\$LOG\")\" = 'plugin install trophy@newkayak12-claude-skills --scope user' ]"
check "d: .done after success" "[ -d \"\$(DONE_P)\" ]"
check "d: lock released" "[ ! -e '$CFG/plugins/.newkayak12-trophy-ride.lock' ]"
check "d: stdout is JSON with systemMessage only" "printf '%s' \"\$out\" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if list(d)==[\"systemMessage\"] and \"Nothing is sent until you say yes\" in d[\"systemMessage\"] else 1)'"
out2=$(run); settle
check "d: next start does nothing" "[ \"\$(calls)\" = 1 ] && [ -z \"\$out2\" ]"

# 2e. install fails -> no .done, lock released, next start retries
fresh; out=$(run FAKE_EXIT=1); settle
check "e: failed install -> no .done" "[ ! -e \"\$(DONE_P)\" ]"
check "e: failed install -> lock released" "[ ! -e '$CFG/plugins/.newkayak12-trophy-ride.lock' ]"
out=$(run); settle
check "e: next start retries and succeeds" "[ \"\$(calls)\" = 2 ] && [ -d \"\$(DONE_P)\" ]"

# 2f. 15 plugins starting together -> exactly one install
fresh
for _ in $(seq 1 15); do run FAKE_SLEEP=1 >/dev/null & done; wait; settle
check "f: 15 concurrent runs -> one install" "[ \"\$(calls)\" = 1 ]"

# 2g. stale lock (older than a day) is reclaimed; a fresh lock is respected
fresh; mkdir "$CFG/plugins/.newkayak12-trophy-ride.lock"
out=$(run); sleep 0.3
check "g: fresh lock -> no install" "[ \"\$(calls)\" = 0 ] && [ -z \"\$out\" ]"
touch -t 202001010000 "$CFG/plugins/.newkayak12-trophy-ride.lock"
out=$(run); settle
check "g: stale lock reclaimed -> install" "[ \"\$(calls)\" = 1 ] && [ -d \"\$(DONE_P)\" ]"

# 2h. the hook returns at once while the install still runs
fresh
start=$(python3 -c 'import time;print(time.time())')
run FAKE_SLEEP=3 >/dev/null
took=$(python3 -c "import time;print(time.time()-$start)")
check "h: hook returns in under 1s while the install runs ($took s)" "python3 -c 'import sys; sys.exit(0 if $took < 1 else 1)'"
check "h: install still running after the hook returned" "[ -d '$CFG/plugins/.newkayak12-trophy-ride.lock' ]"
for _ in $(seq 1 60); do [ -d "$(DONE_P)" ] && break; sleep 0.1; done
check "h: install finishes later" "[ -d \"\$(DONE_P)\" ]"

echo "---"; [ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
