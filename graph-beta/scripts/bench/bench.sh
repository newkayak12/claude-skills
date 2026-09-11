#!/usr/bin/env bash
# One bench run: seed a workspace from a fixture, drive one arm through a headless Claude
# session on the case's request, then score what it left behind.
#
#   bench.sh <arm> <case> [label]
#     arm   beta   graph-beta (task-manager + graph-beta-engineering), skills develop/orchestrate
#           stable graph 1.x (single graph run), skill graph:orchestrate
#           none   no plugin — plain claude -p on the same request (baseline)
#     case  code       fixtures/ledger-mono + requests/code.txt  (4 packages: csv, rules, report, cli)
#           docs       fixtures/tinyq-mono  + requests/docs.txt  (3 package READMEs + architecture + 3 ADRs + CONTRIBUTING + README)
#           code-flat  fixtures/ledger      + requests/code-flat.txt (same work in one empty package: sizes S)
#           docs-flat  fixtures/tinyq       + requests/docs-flat.txt (same docs for one flat library: sizes S)
#
# Workspaces go to $GRAPH_BENCH_OUT (default $TMPDIR/graph-bench) — never inside the plugin
# tree: Claude Code denies Write/Edit under a loaded --plugin-dir. Arms are isolated with
# --setting-sources project (hides installed plugins) plus --plugin-dir for the arm under test.
# `timeout` is not available on macOS; a run ends when the session does.
set -euo pipefail

ARM=${1:?arm: beta|stable|none}
CASE=${2:?case: code|docs}
LABEL=${3:-$(date +%Y%m%d-%H%M%S)}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
OUT=${GRAPH_BENCH_OUT:-${TMPDIR:-/tmp}/graph-bench}
WS="$OUT/$CASE-$ARM-$LABEL"

case "$CASE" in
  code)      FIX=ledger-mono ;;   # 4 workspace packages -> size L
  docs)      FIX=tinyq-mono ;;    # 3 workspace packages -> size L
  code-flat) FIX=ledger ;;        # empty single-package repo -> size S (delegate path)
  docs-flat) FIX=tinyq ;;         # single-package library -> size S (delegate path)
  *) echo "unknown case $CASE" >&2; exit 2 ;;
esac

mkdir -p "$WS"
cp -R "$HERE/fixtures/$FIX/." "$WS/"
git -C "$WS" init -q -b main
git -C "$WS" config user.name bench
git -C "$WS" config user.email bench@example.com
git -C "$WS" add -A
git -C "$WS" commit -q -m seed

REQ=$(cat "$HERE/requests/$CASE.txt")
ROUTING='Pass host_vendor "claude", the model you are actually running as host_model, and the native models you can select as native_models.'
# The monorepo fixtures measure S on their own (one test script, one commit): the second
# round's size agents said so with sound reasons. The beta arm therefore carries the user's
# own words that the work must be split, which the entry skills turn into size: "L".
SPLIT='The user has said, in their own words: "split this by workspace package — one package per worktree, integrated at the end" — so pin size: "L" in tm_open.'
PLUGIN=()
case "$ARM" in
  beta)
    PLUGIN=(--plugin-dir "$REPO/graph-beta")
    if [[ "$CASE" == code* ]]; then
      PROMPT="Use the graph-beta:develop skill to run the following request through the harness. Follow the skill exactly: start with tm_open, drive whatever it hands back (a single graph run or a task of child runs), and end with the skill's output template. $ROUTING $SPLIT Request: $REQ"
    else
      PROMPT="Use the graph-beta:orchestrate skill to run the following request through the harness. Follow the skill exactly: start with tm_open with flow \"auto\", drive whatever it hands back (a single graph run or a task of child runs), and end with the skill's output template. $ROUTING $SPLIT Request: $REQ"
    fi ;;
  stable)
    PLUGIN=(--plugin-dir "$REPO/graph")
    PROMPT="Use the graph:orchestrate skill to run the following request through the harness. Follow the skill exactly: start with graph_open, drive the loop to the end, and end with the skill's output template. $ROUTING Request: $REQ" ;;
  none)
    PROMPT="Complete the following request in this repository. Work until it is fully done and verified; do not stop to ask questions. Request: $REQ" ;;
  *) echo "unknown arm $ARM" >&2; exit 2 ;;
esac

echo "$(date -u +%FT%TZ) start $ARM/$CASE -> $WS" | tee "$WS.start.txt"
set +e
( cd "$WS" && HARNESS_TASKS_DIR="$WS/.harness-tasks" env -u CLAUDECODE claude -p \
    --setting-sources project ${PLUGIN[@]+"${PLUGIN[@]}"} --dangerously-skip-permissions \
    --output-format stream-json --verbose "$PROMPT" < /dev/null \
    > "$WS.stream.jsonl" 2> "$WS.stderr.txt" )
EXIT=$?
set -e
echo "$(date -u +%FT%TZ) exit $EXIT" >> "$WS.start.txt"

node "$HERE/score.mjs" "$CASE" "$WS" "$WS.stream.jsonl" | tee "$WS.score.txt"
