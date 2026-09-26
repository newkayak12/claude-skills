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
#           sprint teams, skill teams:sprint: the case's requests/<case>.backlog.txt (one item per
#                  line, priority = line order) opened as requests[] with the box SPRINT_BOX names
#                  in the user's words (default "a budget of 6 dollars"). SPRINT_FROM=<workspace of
#                  a finished sprint run> reuses that workspace and its .harness-tasks instead of
#                  seeding a fresh one, and tells the session to continue from the prior task
#                  (context_from) with the items its retro left in Next backlog.
#     case  code       fixtures/ledger-mono + requests/code.txt  (4 packages: csv, rules, report, cli)
#           docs       fixtures/tinyq-mono  + requests/docs.txt  (3 package READMEs + architecture + 3 ADRs + CONTRIBUTING + README)
#           code-flat  fixtures/ledger      + requests/code-flat.txt (same work in one empty package: sizes S)
#           docs-flat  fixtures/tinyq       + requests/docs-flat.txt (same docs for one flat library: sizes S)
#           goal-code  fixtures/ledger-mono + requests/goal-code.txt  (a one-line goal; the split is the harness's)
#           goal-docs  fixtures/tinyq-mono  + requests/goal-docs.txt  (a one-line goal; the document set is the harness's)
#           seam       fixtures/seam-mono   + requests/seam.txt      (3 packages - codes/parser/cli - sharing an
#                      error-code table defined in packages/codes; size L, so the harness splits)
#           seam-flat  fixtures/seam        + requests/seam-flat.txt (same domain, one empty package: sizes S)
#           seam-silent fixtures/seam-mono  + requests/seam-silent.txt (byte-identical to seam.txt minus the two
#                      sentences that spell out the answer - "import it from there" and the import.meta.url/macOS
#                      warning - so seam_detected measures coordination instead of instruction-following; size L
#           idol       fixtures/empty       + requests/idol.txt (one line: idol-concert ticketing at 200k
#                      reservations/sec into an empty repository - the PM path's case (idol-pm-1/2, §8h);
#                      run with TEAM_ROLES='{"planning":true}', size pinned L by the idol SPLIT below
#           awake      fixtures/empty-swift + requests/awake.txt (a macOS menu-bar app, SwiftPM only, that keeps
#                      the Mac awake only while Claude Code is working; planning case like idol, size pinned L)
#           trap       fixtures/trap-mono   + requests/trap.txt (3 packages - core/queue/cli - a rate-limited
#                      job scheduler CLI; eight execution-only traps: cap/rate-limit precedence, an inclusive/
#                      exclusive rate-limit boundary, idempotent replay, a stable priority tie-break, an atomic
#                      state-file write under a mid-write kill, invocation invariance, clock injection across a
#                      DST transition, and an "already exists" success-not-error exit code; size L
#
# TEAM_JSON='{"roles":{"planning":true},"interactive":true}' writes .claude/team.json verbatim,
#   for any key the bench needs (interactive, goal_threshold, ...). TEAM_ROLES below is the
#   roles-only shorthand it supersedes.
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

ARM=${1:?arm: beta|betas|skills|stable|none|sprint}
CASE=${2:?case: code|docs|code-flat|docs-flat|goal-code|goal-docs|seam|seam-flat|seam-silent|trap|idol|awake}
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
  seam-silent) FIX=seam-mono ;;   # same fixture and task as seam, request silent on the seam's answer
  trap)      FIX=trap-mono ;;     # 3 workspace packages (core/queue/cli), 8 execution-only traps -> size L
  idol)      FIX=empty ;;         # empty repo, one-line product goal: planning -> shape -> critique
  awake)     FIX=empty-swift ;;   # empty repo, one-paragraph product ticket: planning -> Swift packages
  *) echo "unknown case $CASE" >&2; exit 2 ;;
esac

# A follow-up sprint continues in the prior sprint's workspace: context_from resolves the prior
# task inside HARNESS_TASKS_DIR, so a fresh workspace would have nothing to read back.
if [ -n "${SPRINT_FROM:-}" ]; then
  [ "$ARM" = sprint ] || { echo "SPRINT_FROM needs the sprint arm" >&2; exit 2; }
  WS=$SPRINT_FROM
  PRIOR_TASK=$(ls -t "$WS/.harness-tasks" | head -1)
  SEEDED=1
fi
if [ -z "${SEEDED:-}" ]; then
mkdir -p "$WS"
cp -R "$HERE/fixtures/$FIX/." "$WS/"
# TEAM_ROLES seeds .claude/team.json before the session, which is the only way to exercise the
# planning/QA/audit phase-Teams here: roles are project configuration, not a tm_open argument, so
# without this the whole roles path was unreachable from the bench and had never run against a
# real vendor at all. Value is the roles object as JSON, e.g. TEAM_ROLES='{"planning":true}'.
# Committed with the seed so the run starts from a clean tree, exactly like every other file.
# TEAM_JSON writes the whole file verbatim, for any other team.json key the bench needs to
# reach - `interactive` among them, which is the only way to exercise the `ask` card here for
# the same reason TEAM_ROLES exists: it is project configuration, not a tm_open argument. Takes
# precedence over TEAM_ROLES; set one or the other.
if [ -n "${TEAM_JSON:-}" ]; then
  mkdir -p "$WS/.claude"
  printf '%s\n' "$TEAM_JSON" > "$WS/.claude/team.json"
elif [ -n "${TEAM_ROLES:-}" ]; then
  mkdir -p "$WS/.claude"
  printf '{"roles": %s}\n' "$TEAM_ROLES" > "$WS/.claude/team.json"
fi
git -C "$WS" init -q -b main
git -C "$WS" config user.name bench
git -C "$WS" config user.email bench@example.com
git -C "$WS" add -A
git -C "$WS" commit -q -m seed
fi

REQ=$(cat "$HERE/requests/$CASE.txt")
ROUTING='Pass host_vendor "claude", the model you are actually running as host_model, and the native models you can select as native_models.'
# The monorepo fixtures measure S on their own (one test script, one commit): the second
# round's size agents said so with sound reasons. The beta arm therefore carries the user's
# own words that the work must be split, which the entry skills turn into size: "L".
SPLIT='The user has said, in their own words: "split this by workspace package — one package per worktree, integrated at the end" — so pin size: "L" in tm_open.'
# An empty repository has no workspace packages to split by; the idol case pins L in words that fit it.
[[ "$CASE" == idol || "$CASE" == awake ]] && SPLIT='The user has said, in their own words: "this is a large system - split it into packages, one per worktree, integrated at the end" - so pin size: "L" in tm_open.'
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
    if [[ "$CASE" == code* || "$CASE" == goal-code || "$CASE" == seam* || "$CASE" == trap || "$CASE" == idol || "$CASE" == awake ]]; then
      PROMPT="Use the teams:develop skill to run the following request through the harness. Follow the skill exactly: start with tm_open, drive whatever it hands back (a single graph run or a task of child runs), and end with the skill's output template. $ROUTING $SPLIT Request: $REQ"
    else
      PROMPT="Use the teams:orchestrate skill to run the following request through the harness. Follow the skill exactly: start with tm_open with flow \"auto\", drive whatever it hands back (a single graph run or a task of child runs), and end with the skill's output template. $ROUTING $SPLIT Request: $REQ"
    fi ;;
  sprint)
    PLUGIN=(--plugin-dir "$REPO/teams")
    BACKLOG=$(awk 'NF {printf "%d. %s\n", NR-1, $0}' "$HERE/requests/$CASE.backlog.txt")
    BOX=${SPRINT_BOX:-a budget of 6 dollars}
    if [ -n "${PRIOR_TASK:-}" ]; then
      PROMPT="Use the teams:sprint skill to open the next Sprint. The prior Sprint's task is $PRIOR_TASK - continue from it with context_from, and make this Sprint's backlog the items its retro left undone, in the same priority order. Hold it to $BOX. Nobody is around to answer questions. Follow the skill exactly, drive it to the end, and end with the skill's output template. $ROUTING"
    else
      PROMPT="Use the teams:sprint skill to run this backlog as one Sprint, held to $BOX. Nobody is around to answer questions. Follow the skill exactly, drive it to the end, and end with the skill's output template. $ROUTING The repository is a Node 22 monorepo \`ledger\`: the root package.json declares workspaces packages/* and \`npm test\` runs \`node --test\` over every package; each package has its own package.json, a stub src/index.mjs and a smoke test. ES modules, no dependencies, relative imports between packages (no npm install). Backlog, highest priority first:
$BACKLOG"
    fi ;;
  stable)
    PLUGIN=(--plugin-dir "$REPO/graph")
    PROMPT="Use the graph:orchestrate skill to run the following request through the harness. Follow the skill exactly: start with graph_open, drive the loop to the end, and end with the skill's output template. $ROUTING Request: $REQ" ;;
  none)
    PROMPT="Complete the following request in this repository. Work until it is fully done and verified; do not stop to ask questions. Request: $REQ" ;;
  *) echo "unknown arm $ARM" >&2; exit 2 ;;
esac

OUTB=$WS; [ -n "${PRIOR_TASK:-}" ] && OUTB="$WS.next"
echo "$(date -u +%FT%TZ) start $ARM/$CASE -> $WS" | tee "$OUTB.start.txt"
set +e
( cd "$WS" && HARNESS_TASKS_DIR="$WS/.harness-tasks" env -u CLAUDECODE claude -p \
    --setting-sources project ${PLUGIN[@]+"${PLUGIN[@]}"} --dangerously-skip-permissions \
    --output-format stream-json --verbose "$PROMPT" < /dev/null \
    > "$OUTB.stream.jsonl" 2> "$OUTB.stderr.txt" )
EXIT=$?
set -e
echo "$(date -u +%FT%TZ) exit $EXIT" >> "$OUTB.start.txt"

node "$HERE/score.mjs" "$CASE" "$WS" "$OUTB.stream.jsonl" | tee "$OUTB.score.txt"
