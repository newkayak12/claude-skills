#!/usr/bin/env bash
# One bench run: seed a workspace from a fixture, drive one arm through a headless Claude
# session on the case's request, then score what it left behind.
#
#   bench.sh <arm> <case> [label]
#     arm   beta   teams (task-manager + teams-engineering), skills develop/orchestrate;
#                  the prompt carries the user's words that the work must be split -> size pinned L
#           betas  teams without those words: size measures on its own (S on these fixtures),
#                  one graph run through the delegate path - the same topology as `stable`
#           skills betas, plus --plugin-dir for every plugin the harness's STAGE_SKILLS /
#                  kindSkills tables actually name (develop, think, cognition, completion, write)
#                  so `skills_used` can be something other than the graceful "none" fallback —
#                  measures whether the mounted skills change the outcome, not the engine itself
#           stable graph 1.x (single graph run), skill graph:orchestrate
#           none   no plugin — plain claude -p on the same request (baseline)
#     case  code       fixtures/ledger-mono + requests/code.txt  (4 packages: csv, rules, report, cli)
#           docs       fixtures/tinyq-mono  + requests/docs.txt  (3 package READMEs + architecture + 3 ADRs + CONTRIBUTING + README)
#           code-flat  fixtures/ledger      + requests/code-flat.txt (same work in one empty package: sizes S)
#           docs-flat  fixtures/tinyq       + requests/docs-flat.txt (same docs for one flat library: sizes S)
#           goal-code  fixtures/ledger-mono + requests/goal-code.txt  (a one-line goal; the split is the harness's)
#           goal-docs  fixtures/tinyq-mono  + requests/goal-docs.txt  (a one-line goal; the document set is the harness's)
#           seam       fixtures/seam-mono   + requests/seam.txt      (3 packages - codes/parser/cli - sharing an
#                      error-code table defined in packages/codes; size L, so the harness splits)
#           seam-flat  fixtures/seam        + requests/seam-flat.txt (same domain, one empty package: sizes S)
#
# TEAM_ROLES='{"planning":true,"qa":true}' seeds .claude/team.json into the workspace before the
#   session. Roles are project configuration rather than a tm_open argument, so this is the only
#   way to reach the planning/QA/audit phase-Teams from here - without it that whole path had
#   never run against a real vendor. Only the beta/betas/skills arms read it.
#
# Workspaces go to $GRAPH_BENCH_OUT (default $TMPDIR/graph-bench) — never inside the plugin
# tree: Claude Code denies Write/Edit under a loaded --plugin-dir. Arms are isolated with
# --setting-sources project (hides installed plugins) plus --plugin-dir for the arm under test.
# `timeout` is not available on macOS; a run ends when the session does.
set -euo pipefail

ARM=${1:?arm: beta|betas|skills|stable|none}
CASE=${2:?case: code|docs|code-flat|docs-flat|goal-code|goal-docs|seam|seam-flat}
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
  goal-code) FIX=ledger-mono ;;   # one-line goal: the harness decides the split and the contracts
  goal-docs) FIX=tinyq-mono ;;    # one-line goal: the harness decides the document set
  seam)      FIX=seam-mono ;;     # 3 workspace packages (codes/parser/cli) -> size L
  seam-flat) FIX=seam ;;          # same domain, empty single-package repo -> size S (delegate path)
  *) echo "unknown case $CASE" >&2; exit 2 ;;
esac

mkdir -p "$WS"
cp -R "$HERE/fixtures/$FIX/." "$WS/"
# TEAM_ROLES seeds .claude/team.json before the session, which is the only way to exercise the
# planning/QA/audit phase-Teams here: roles are project configuration, not a tm_open argument, so
# without this the whole roles path was unreachable from the bench and had never run against a
# real vendor at all. Value is the roles object as JSON, e.g. TEAM_ROLES='{"planning":true}'.
# Committed with the seed so the run starts from a clean tree, exactly like every other file.
if [ -n "${TEAM_ROLES:-}" ]; then
  mkdir -p "$WS/.claude"
  printf '{"roles": %s}\n' "$TEAM_ROLES" > "$WS/.claude/team.json"
fi
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
  beta|betas|skills)
    [ "$ARM" = betas ] && SPLIT=''
    [ "$ARM" = skills ] && SPLIT=''
    PLUGIN=(--plugin-dir "$REPO/teams")
    if [ "$ARM" = skills ]; then
      # Every plugin any STAGE_SKILLS / kindSkills entry in taskmanager.mjs or graph.mjs names
      # (develop:domain-driven-design, develop:architecture-designer, develop:clean-code,
      # develop:testing-workflow, think:devils-advocate, cognition:assumption-extractor,
      # cognition:epistemic-reasoner, cognition:second-order-thinker,
      # cognition:critical-thinking-workflow, completion:verification-before-completion,
      # write:doc-coauthoring, write:writer-verification) plus `agents`, named explicitly by the
      # round that asked for this arm. Without these mounted every one of those Skill() calls
      # misses and the run falls back silently — round 3's `skills_used: ["none"]` on every
      # manager stage was this, not a bug: the arms before `skills` never mounted anything but
      # teams. Mounted only when the directory exists, so a checkout missing one plugin
      # still runs the rest instead of failing --plugin-dir.
      for p in develop think cognition completion write agents; do
        [ -d "$REPO/$p" ] && PLUGIN+=(--plugin-dir "$REPO/$p")
      done
    fi
    if [[ "$CASE" == code* || "$CASE" == goal-code || "$CASE" == seam* ]]; then
      PROMPT="Use the teams:develop skill to run the following request through the harness. Follow the skill exactly: start with tm_open, drive whatever it hands back (a single graph run or a task of child runs), and end with the skill's output template. $ROUTING $SPLIT Request: $REQ"
    else
      PROMPT="Use the teams:orchestrate skill to run the following request through the harness. Follow the skill exactly: start with tm_open with flow \"auto\", drive whatever it hands back (a single graph run or a task of child runs), and end with the skill's output template. $ROUTING $SPLIT Request: $REQ"
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
