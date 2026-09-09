#!/usr/bin/env bash
# lib.sh — shared helpers for the scenario evals. Source it.
EVALS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$EVALS_DIR/../../../.." && pwd)"
FIXTURE="$EVALS_DIR/fixture"
CI_MD="$REPO_DIR/develop/skills/scenario-actor/references/ci.md"
# Bench workspaces must live OUTSIDE the plugin tree: Claude Code denies Write/Edit under a loaded --plugin-dir.
BENCH_OUT="${SCENARIO_BENCH_OUT:-${TMPDIR:-/tmp}/scenario-bench}"

free_port(){ python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
# start_server PORT [--bug] -> sets SERVER_PID
start_server(){ python3 "$FIXTURE/server.py" "$1" ${2:-} >/dev/null 2>&1 & SERVER_PID=$!
  for _ in $(seq 25); do curl -s "http://127.0.0.1:$1/" >/dev/null 2>&1 && return 0; sleep 0.2; done
  echo "server did not start on $1" >&2; return 1; }
stop_server(){ kill "${SERVER_PID:-0}" 2>/dev/null; wait "${SERVER_PID:-0}" 2>/dev/null; }
# extract_ci DEST -> writes ci.sh from the first bash block of ci.md
extract_ci(){ awk '/^```bash$/{f++; next} /^```$/{if(f==1)f=99} f==1' "$CI_MD" > "$1" && chmod +x "$1"; }
# jget FILE KEY -> top-level JSON value or ""
jget(){ python3 -c 'import sys,json
try: print(json.load(open(sys.argv[1])).get(sys.argv[2],""))
except Exception: print("")' "$1" "$2"; }
