#!/usr/bin/env bash
# Continue an interrupted bench workspace in a fresh headless session.
#
#   resume.sh <workspace> [n]
#
# A session that dies mid-run (a usage limit, a crash) leaves the task under
# <ws>/.harness-tasks and every run file under .harness-run — all of it resumable. This opens a
# new session at the same cwd and tells the skill to continue what is there instead of opening
# again: tm_status/tm_next for a task, graph_status({cwd})/graph_next for a bare run. The stream
# goes to <ws>.stream.resume<n>.jsonl; score.mjs sums every stream of a workspace.
set -euo pipefail

WS=${1:?workspace}
N=${2:-1}
WS=$(cd "$WS" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
NAME=$(basename "$WS")            # <case>-<arm>-<label>
CASE=${NAME%%-*}
ARM=$(echo "$NAME" | cut -d- -f2)
REQ=$(cat "$HERE/requests/$CASE.txt")
ROUTING='Pass host_vendor "claude", the model you are actually running as host_model, and the native models you can select as native_models — the same routing the task was opened with.'

case "$ARM" in
  beta)
    PLUGIN=(--plugin-dir "$REPO/graph-beta")
    TASK_ID=$(ls "$WS/.harness-tasks" 2>/dev/null | head -1 || true)
    if [ -n "$TASK_ID" ]; then
      PROMPT="Use the graph-beta:orchestrate skill, but CONTINUE the task that is already open for this project instead of opening one: task_id $TASK_ID at cwd $WS. Do not call tm_open or graph_open. Read references/manager.md and references/loop.md, then call tm_status({task_id}) and tm_next({task_id}) and drive exactly as the manager loop says: a fresh agent for every ready manager node (relay its JSON to tm_submit), every child in children[] driven with loop.md at its own child.cwd (graph_next/graph_run/graph_submit carry that cwd), a child that is complete or blocked folded with tm_submit and no payload, tm_retry on failures. $ROUTING End with the skill's output template. The original request was: $REQ"
    else
      PROMPT="Use the graph-beta:orchestrate skill, but CONTINUE the graph run that is already open at this cwd instead of opening one: call graph_status({cwd: \"$WS\"}), take the run whose state is running, and drive it with references/loop.md from graph_next on. Do not call tm_open or graph_open. $ROUTING End with the skill's output template. The original request was: $REQ"
    fi ;;
  stable)
    PLUGIN=(--plugin-dir "$REPO/graph")
    PROMPT="Use the graph:orchestrate skill, but CONTINUE the graph run that is already open at this cwd instead of opening one: call graph_status({cwd: \"$WS\"}), take the run whose state is running, and drive the loop from graph_next on. Do not call graph_open. $ROUTING End with the skill's output template. The original request was: $REQ" ;;
  *) echo "resume is for beta and stable workspaces, not $ARM" >&2; exit 2 ;;
esac

echo "$(date -u +%FT%TZ) resume $N $ARM/$CASE -> $WS" | tee -a "$WS.start.txt"
set +e
( cd "$WS" && HARNESS_TASKS_DIR="$WS/.harness-tasks" env -u CLAUDECODE claude -p \
    --setting-sources project "${PLUGIN[@]}" --dangerously-skip-permissions \
    --output-format stream-json --verbose "$PROMPT" < /dev/null \
    > "$WS.stream.resume$N.jsonl" 2> "$WS.stderr.resume$N.txt" )
EXIT=$?
set -e
echo "$(date -u +%FT%TZ) resume $N exit $EXIT" >> "$WS.start.txt"

STREAMS=$(ls "$WS".stream*.jsonl | tr '\n' ',' | sed 's/,$//')
node "$HERE/score.mjs" "$CASE" "$WS" "$STREAMS" | tee "$WS.score.txt"
