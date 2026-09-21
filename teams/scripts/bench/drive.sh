#!/usr/bin/env bash
# Run bench jobs one after another, resuming across usage-limit resets.
#
#   drive.sh "<arm> <case> <label>" ["<arm> <case> <label>" ...]
#
# A job whose workspace does not exist starts with bench.sh; one that exists is resumed with
# resume.sh. After each session the newest stream is read for how it ended:
#   - no `result` event at all  -> the session was killed from outside (a memory kill, a SIGKILL,
#     the terminal going away). Nothing to wait for: resume straight away.
#   - a usage-limit message     -> "resets 11:50pm (Asia/Seoul)" is parsed, the driver sleeps
#     until then plus a margin, then resumes.
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
  # per docs/diagrams/teams-first-real-run.mmd:33-35, once did - exit while those are still
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

# --- The waiting seam (plan docs/plans/2026-09-21-teams-server-owns-the-loop.md §4) -----------
# A headless bench must wait OUTSIDE any model session (§4-C): waiting inside a session charges
# the arm under test for turns spent polling, not for work (§3 of that plan: 125 polling turns,
# $4.53, for one run). wait_for_settle is that whole waiting strategy behind one name - today it
# polls task_settle_state (pure disk reads, zero model turns) on an interval up to a hard
# ceiling. The `teams run` CLI in the daemon work referenced by that plan is meant to replace
# this polling with a single blocking, zero-turn wait; when it exists, swap this function's body
# for a call to it - nothing else in drive.sh should need to change.
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

sleep_until_reset() {  # "resets 11:50pm (Asia/Seoul)" -> sleep until then (+3 min); else 30 min
  local text=$1 hm ap h m target now
  if [[ $text =~ resets\ ([0-9]{1,2}):([0-9]{2})(am|pm) ]]; then
    h=${BASH_REMATCH[1]}; m=${BASH_REMATCH[2]}; ap=${BASH_REMATCH[3]}
    [ "$ap" = pm ] && [ "$h" -ne 12 ] && h=$((h + 12))
    [ "$ap" = am ] && [ "$h" -eq 12 ] && h=0
    target=$(date -j -f "%Y-%m-%d %H:%M" "$(date +%Y-%m-%d) $(printf '%02d:%02d' "$h" "$m")" +%s 2>/dev/null || echo 0)
    now=$(date +%s)
    # The message names the next reset. Read fresh it is ahead of us; read a little late (a
    # driver restarted after the reset) it is minutes behind, and the window has reset: resume
    # now. Hours behind means the clock time is tomorrow's - a message at 23:55 saying 4:50am.
    if [ "$target" -le "$now" ] && [ $((now - target)) -le 3600 ]; then echo "$(date -u +%FT%TZ) limit hit; reset time already passed, resuming"; return 0; fi
    [ "$target" -le "$now" ] && target=$((target + 86400))
    echo "$(date -u +%FT%TZ) limit hit; sleeping until $(date -r $((target + 180)) '+%H:%M')"
    sleep $((target + 180 - now))
  else
    echo "$(date -u +%FT%TZ) limit hit; no reset time parsed, sleeping 30 min"
    sleep 1800
  fi
}

for job in "$@"; do
  read -r arm case label <<<"$job"
  ws="$OUT/$case-$arm-$label"
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
      elif [ "$fresh" = 1 ]; then sleep_until_reset "$text"
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
    # running: docs/diagrams/teams-first-real-run.mmd:33-35).
    echo "$(date -u +%FT%TZ) $job: top-level session ended; waiting for the task to settle"
    IFS=$'\t' read -r settle_status settle_reason < <(wait_for_settle "$ws")
    echo "$(date -u +%FT%TZ) $job: scoring now ($settle_status) - $settle_reason"
    streams=$(ls "$ws".stream*.jsonl 2>/dev/null | tr '\n' ',' | sed 's/,$//')
    node "$HERE/score.mjs" "$case" "$ws" "$streams" | tee "$ws.score.txt"
    echo "$(date -u +%FT%TZ) done $job"
    break
  done
done
