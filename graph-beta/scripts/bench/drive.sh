#!/usr/bin/env bash
# Run bench jobs one after another, resuming across usage-limit resets.
#
#   drive.sh "<arm> <case> <label>" ["<arm> <case> <label>" ...]
#
# A job whose workspace does not exist starts with bench.sh; one that exists is resumed with
# resume.sh. After each session the last result text is checked for a usage-limit message;
# "resets 11:50pm (Asia/Seoul)" is parsed, the driver sleeps until then plus a margin, and the
# job is resumed. A job ends when a session finishes for any other reason (complete or blocked
# are both results). At most MAX_RESUMES (default 6) resumes per job.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${GRAPH_BENCH_OUT:-${TMPDIR:-/tmp}/graph-bench}
MAX=${MAX_RESUMES:-6}

last_result_text() {  # newest stream of a workspace -> its result text (or empty)
  local ws=$1 f
  f=$(ls -t "$ws".stream*.jsonl 2>/dev/null | head -1)
  [ -n "$f" ] || return 0
  python3 - "$f" <<'EOF'
import json,sys
last=None
for line in open(sys.argv[1]):
    try: e=json.loads(line)
    except Exception: continue
    if e.get('type')=='result': last=e
print((last or {}).get('result') or '')
EOF
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
  n=0
  fresh=0   # 1 once a session ran under this driver: only then is a limit message's reset time current
  if [ ! -d "$ws" ]; then
    echo "$(date -u +%FT%TZ) start $job"
    "$HERE/bench.sh" "$arm" "$case" "$label"
    fresh=1
  fi
  while :; do
    text=$(last_result_text "$ws")
    if [[ $text =~ hit\ your\ (session|usage)\ limit ]]; then
      if [ "$n" -ge "$MAX" ]; then echo "$(date -u +%FT%TZ) $job: gave up after $n resumes"; break; fi
      # A limit message left by an earlier driver names a reset that has long passed: resume now.
      if [ "$fresh" = 1 ]; then sleep_until_reset "$text"; else echo "$(date -u +%FT%TZ) stale limit message from before this driver; resuming"; fi
      fresh=1
      n=$((n + 1))
      echo "$(date -u +%FT%TZ) resume $n of $job"
      "$HERE/resume.sh" "$ws" "$n"
      continue
    fi
    echo "$(date -u +%FT%TZ) done $job"; cat "$ws.score.txt" 2>/dev/null
    break
  done
done
