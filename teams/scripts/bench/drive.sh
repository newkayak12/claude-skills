#!/usr/bin/env bash
# Run bench jobs one after another, resuming across usage-limit resets.
#
#   drive.sh "<arm> <case> <label>" ["<arm> <case> <label>" ...]
#
# Teams arms (beta, betas, skills) go through `teams run` (scripts/run.mjs, wait-model C of
# _repo/docs/plans/2026-09-21-teams-server-owns-the-loop.md §4): a new workspace is seeded and run by
# `BENCH_VIA=run bench.sh`, an existing one is resumed with `run.mjs --resume <task_id>`, and in
# both the CLI itself waits until the task settles and sleeps through a usage-limit reset
# (--resume-on-limit, at most MAX_RESUMES resumes). No model session watches it, and none of the
# session loop below runs for them (run_job). DRIVE_VIA=session puts them back on that loop.
#
# Every other arm (stable, none, sprint) is a `claude -p` session. A job whose workspace does not
# exist starts with bench.sh; one that exists is resumed with resume.sh. After each session the
# newest stream is read for how it ended:
#   - no `result` event at all  -> the session was killed from outside (a memory kill, a SIGKILL,
#     the terminal going away). Nothing to wait for: resume straight away.
#   - a usage-limit message     -> lib/until-reset.mjs (run.mjs's own parser and minute-step
#     sleep) waits until the reset it names plus a margin, then resumes.
#   - anything else             -> the session ended on its own (complete or blocked are both
#     results) and the job is done.
# At most MAX_RESUMES (default 6) resumes per job.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${GRAPH_BENCH_OUT:-${TMPDIR:-/tmp}/graph-bench}
MAX=${MAX_RESUMES:-6}

stream_end() {  # newest stream of a workspace -> "killed", or "ended\t<result text>"
  local ws=$1 f
  f=$(ls -t "$ws".stream*.jsonl 2>/dev/null | head -1)
  [ -n "$f" ] || { echo killed; return 0; }
  python3 - "$f" <<'EOF'
import json,sys
last=None
for line in open(sys.argv[1]):
    try: e=json.loads(line)
    except Exception: continue
    if e.get('type')=='result': last=e
# A stream that never carried a result event is a session that was killed from outside; the
# work on disk is untouched and resumable. An empty result text is still an ended session.
print('killed' if last is None else 'ended\t' + (last.get('result') or '').replace('\n',' '))
EOF
}

task_settle_state() {  # workspace dir -> "no-task|complete|running\t<reason>"
  # The work does not live in the top-level session drive.sh just watched: teams (arm beta/
  # betas/skills) hands off to a detached leader process, which spawns further detached driver
  # processes per dispatch node (task.json's `.child.driver`). The top-level session can - and,
  # per _repo/docs/diagrams/teams-first-real-run.mmd:33-35, once did - exit while those are still
  # working. This inspects <ws>/.harness-tasks/*/task.json on disk only (no model calls, no
  # network) to tell whether the actual work is finished, still in flight, or dead in a way that
  # will never finish on its own (a driver process that has already exited while its node is
  # still marked "running" - archived example: goal-code-beta-R1's dispatch:AUDIT:1, killed by an
  # HTTP 429). It does not try to resurrect a stalled run - only to avoid scoring one as if the
  # run had reached a report node, or if it had died in a way that would look like an
  # explanations-only "running" state forever.
  python3 - "$1" <<'EOF'
import json, os, sys, glob

ws = sys.argv[1]

def alive(pid, exit_file):
    # An exit file on disk means the process already ran to completion (however it ended) -
    # decisive regardless of what the pid check below would say. Its absence does not prove
    # aliveness (a killed process may never get the chance to write one), so fall through to a
    # real pid check.
    if exit_file and os.path.exists(exit_file):
        return False
    if not pid:
        return None  # no pid on record - unknown, not claimed alive
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists, owned by someone else - treat as alive
    except Exception:
        return None

def child_run_summary(node):
    child = node.get('child') or {}
    cwd, rid = child.get('cwd'), child.get('run_id')
    if not cwd or not rid:
        return ''
    path = os.path.join(cwd, '.teams_output', 'broker', 'runs', rid + '.json')
    try:
        d = json.load(open(path))
    except Exception:
        return ''
    nodes = d.get('nodes') or []
    done = sum(1 for n in nodes if n.get('state') == 'done')
    reported = any(n.get('stage') == 'report' and n.get('state') == 'done' for n in nodes)
    return f" child_run={rid[:8]} {done}/{len(nodes)} nodes done report_done={reported}"

task_files = sorted(glob.glob(os.path.join(ws, '.harness-tasks', '*', 'task.json')))
if not task_files:
    print('no-task\tno .harness-tasks under this workspace (arm has no task manager, or the task was never opened)')
    sys.exit(0)

# Every task file found must be settled for the workspace to count as settled; the first one
# that is still running decides the (single) verdict reported back.
best = None  # ('complete'|'running', reason)
for tf in task_files:
    tdir = os.path.basename(os.path.dirname(tf))
    try:
        d = json.load(open(tf))
    except Exception as e:
        best = ('running', f'{tdir}: task.json unreadable ({e}) - treating as not settled')
        break
    nodes = d.get('nodes') or []
    reports = [n for n in nodes if n.get('stage') == 'report']
    if any(n.get('state') == 'done' for n in reports):
        if best is None:
            best = ('complete', f'{tdir}: report node done')
        continue
    running = [n for n in nodes if n.get('state') == 'running']
    pending = [n for n in nodes if n.get('state') == 'pending']
    leader = d.get('leader') or {}
    leader_alive = alive(leader.get('pid'), leader.get('exit'))
    parts = [f'leader_alive={leader_alive}']
    for n in running:
        drv = ((n.get('child') or {}).get('driver')) or {}
        a = alive(drv.get('pid'), drv.get('exit'))
        parts.append(f"{n['node_id']} driver_alive={a}{child_run_summary(n)}")
    if not running and pending:
        parts.append(f"pending_no_running={[n['node_id'] for n in pending][:5]}")
    best = ('running', f"{tdir}: " + ' '.join(parts))
    break  # this task file alone is enough to keep the workspace not-settled

print(f"{best[0]}\t{best[1]}")
EOF
}

# --- The waiting seam (plan _repo/docs/plans/2026-09-21-teams-server-owns-the-loop.md §4) -----------
# A headless bench must wait OUTSIDE any model session (§4-C): waiting inside a session charges
# the arm under test for turns spent polling, not for work (§3 of that plan: 125 polling turns,
# $4.53, for one run). wait_for_settle is that whole waiting strategy behind one name - today it
# polls task_settle_state (pure disk reads, zero model turns) on an interval up to a hard
# ceiling. The teams arms no longer come through here: `teams run` is that single blocking,
# zero-turn wait (run_job below). What still does is a session arm whose session opens a task
# (sprint, or any teams arm under DRIVE_VIA=session).
wait_for_settle() {
  local ws=$1 elapsed=0 poll=${SETTLE_POLL_SECONDS:-30} ceiling=$((${SETTLE_MAX_MINUTES:-60} * 60))
  local status reason
  while :; do
    IFS=$'\t' read -r status reason < <(task_settle_state "$ws")
    if [ "$status" != running ]; then echo "$status"$'\t'"$reason"; return 0; fi
    if [ "$elapsed" -ge "$ceiling" ]; then
      echo "ceiling"$'\t'"$reason (still not settled after ${ceiling}s; scoring anyway)"
      return 0
    fi
    sleep "$poll"
    elapsed=$((elapsed + poll))
  done
}

# "<limit text>" <stream it came from> -> sleep until the named reset (+3 min); else 30 min.
# The parser and the minute-step sleep are run.mjs's (--resume-on-limit), not a copy: the reset
# is the first one after the stream's mtime (when the limit hit), so a notice read a little
# late resumes at once and a 23:55 notice saying 4:50am means tomorrow.
sleep_until_reset() {
  node "$HERE/lib/until-reset.mjs" "$1" --since-file "$2"
}

# Keep the Mac from idle-sleeping for exactly as long as this driver lives, and not a second
# longer: idol-pm4 (2026-09-23) lost five hours to a sleeping laptop. `-w $$` ties the assertion to
# this process, so a killed driver cannot leave the machine stuck awake.
command -v caffeinate >/dev/null && caffeinate -i -w $$ &

# Teams arms: `teams run` opens (or resumes), waits for the task to settle and sleeps through
# usage-limit resets itself; all that is left here is scoring and the audit.
run_job() {
  local job=$1 arm=$2 case=$3 label=$4 ws=$5 task streams
  if [ ! -d "$ws" ]; then
    echo "$(date -u +%FT%TZ) start $job (teams run)"
    BENCH_VIA=run "$HERE/bench.sh" "$arm" "$case" "$label"   # seeds, runs to settle, scores, harvests
  else
    task=$(ls "$ws/.harness-tasks" 2>/dev/null | head -1 || true)
    if [ -z "$task" ]; then echo "$(date -u +%FT%TZ) $job: no task under $ws/.harness-tasks to resume; stopping"; return 0; fi
    echo "$(date -u +%FT%TZ) resume $job (teams run --resume $task)"
    ( cd "$ws" && HARNESS_TASKS_DIR="$ws/.harness-tasks" env -u CLAUDECODE \
        node "$HERE/../run.mjs" --resume "$task" --json --resume-on-limit --max-resumes "$MAX" < /dev/null \
        >> "$ws.run.jsonl" 2>> "$ws.stderr.txt" )
    echo "$(date -u +%FT%TZ) $job: teams run exit $?"
    streams=$(ls "$ws".stream*.jsonl 2>/dev/null | tr '\n' ',' | sed 's/,$//')
    node "$HERE/score.mjs" "$case" "$ws" "$streams" | tee "$ws.score.txt"
    node "$HERE/harvest.mjs" "$ws" --score-prefix "$ws" || true
  fi
  if [ "${GRAPH_BENCH_AUDIT:-1}" != 0 ]; then
    node "$HERE/audit.mjs" "$case" "$ws" | tee -a "$ws.score.txt"
  fi
  echo "$(date -u +%FT%TZ) done $job"
}

for job in "$@"; do
  read -r arm case label <<<"$job"
  ws="$OUT/$case-$arm-$label"
  if [ "${DRIVE_VIA:-run}" = run ] && [[ "$arm" == beta || "$arm" == betas || "$arm" == skills ]]; then
    run_job "$job" "$arm" "$case" "$label" "$ws"
    continue
  fi
  # Resume streams are numbered from what is already on disk, not from zero: a second driver
  # over the same workspace used to reopen .stream.resume1.jsonl and overwrite the first
  # driver's session, losing its cost and turns from every later sum.
  n=$(ls "$ws".stream.resume*.jsonl 2>/dev/null | wc -l | tr -d ' ')
  fresh=0   # 1 once a session ran under this driver: only then is a limit message's reset time current
  if [ ! -d "$ws" ]; then
    echo "$(date -u +%FT%TZ) start $job"
    "$HERE/bench.sh" "$arm" "$case" "$label"
    fresh=1
  fi
  while :; do
    end=$(stream_end "$ws")
    text=${end#*$'\t'}
    [ "$end" = killed ] && text=''
    # Limit messages name the window: "session limit", "usage limit", "weekly limit",
    # "5-hour limit". Matching only two of them read a weekly limit as a clean ending and
    # marked a job done mid-task.
    if [ "$end" = killed ] || [[ $text =~ hit\ your\ [a-z0-9-]+\ limit ]]; then
      if [ "$n" -ge "$MAX" ]; then echo "$(date -u +%FT%TZ) $job: gave up at resume $n"; break; fi
      if [ "$end" = killed ]; then
        echo "$(date -u +%FT%TZ) $job: session killed with no result event; resuming"
      # A limit message left by an earlier driver names a reset that has long passed: resume now.
      elif [ "$fresh" = 1 ]; then sleep_until_reset "$text" "$(ls -t "$ws".stream*.jsonl 2>/dev/null | head -1)"
      else echo "$(date -u +%FT%TZ) stale limit message from before this driver; resuming"; fi
      fresh=1
      n=$((n + 1))
      echo "$(date -u +%FT%TZ) resume $n of $job"
      before=$(ls "$ws".stream*.jsonl 2>/dev/null | wc -l)
      "$HERE/resume.sh" "$ws" "$n"
      # resume.sh that never opened a session (bad arguments, a missing request file) leaves the
      # streams untouched: the loop would read the same "killed" and spin. Stop the job instead.
      if [ "$(ls "$ws".stream*.jsonl 2>/dev/null | wc -l)" = "$before" ]; then
        echo "$(date -u +%FT%TZ) $job: resume started no session; stopping"; break
      fi
      continue
    fi
    # The top-level session ended (cleanly or blocked) - but the work may not have: teams'
    # leader/driver processes are detached and can still be running (see task_settle_state
    # above). Score only once that work has actually settled, or a hard ceiling gives up on it -
    # never on the top-level session's exit alone (that was scoring a run that was still
    # running: _repo/docs/diagrams/teams-first-real-run.mmd:33-35).
    echo "$(date -u +%FT%TZ) $job: top-level session ended; waiting for the task to settle"
    IFS=$'\t' read -r settle_status settle_reason < <(wait_for_settle "$ws")
    echo "$(date -u +%FT%TZ) $job: scoring now ($settle_status) - $settle_reason"
    streams=$(ls "$ws".stream*.jsonl 2>/dev/null | tr '\n' ',' | sed 's/,$//')
    node "$HERE/score.mjs" "$case" "$ws" "$streams" | tee "$ws.score.txt"
    # Post-hoc adversarial defect audit: an independent reviewer, blind to which arm produced
    # the tree, runs against the same deliverable score.mjs just judged. GRAPH_BENCH_AUDIT=0
    # opts out (e.g. when only the criteria checklist is wanted, or claude is unavailable).
    if [ "${GRAPH_BENCH_AUDIT:-1}" != 0 ]; then
      node "$HERE/audit.mjs" "$case" "$ws" | tee -a "$ws.score.txt"
    fi
    echo "$(date -u +%FT%TZ) done $job"
    break
  done
done
