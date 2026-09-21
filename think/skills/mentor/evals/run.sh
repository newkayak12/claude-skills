#!/usr/bin/env bash
# run.sh <arm: skill|base> [fixture...] — one claude -p per fixture, in parallel.
# env: MENTOR_MODEL (sonnet) · MENTOR_OUT ($TMPDIR/mentor-bench) · MENTOR_PARALLEL (3)
set -uo pipefail
cd "$(dirname "$0")"
ARM=${1:?arm: skill | base}; shift || true
REPO=$(cd ../../../.. && pwd)
OUT="${MENTOR_OUT:-${TMPDIR:-/tmp}/mentor-bench}/$ARM"; mkdir -p "$OUT"
MODEL="${MENTOR_MODEL:-sonnet}"
specs=(); for a in "$@"; do
  if [ -f "$a" ]; then specs+=("$a"); else specs+=(fixtures/${a%.md}*.md); fi
done
[ ${#specs[@]} -eq 0 ] && specs=(fixtures/f*.md)
for s in "${specs[@]}"; do [ -f "$s" ] || { echo "no such fixture: $s"; exit 2; }; done

one() {
  local f=$1 id body prompt
  id=$(basename "$f" .md)
  field() { python3 -c '
import sys, re
t = open(sys.argv[1]).read()
m = re.search(r"^" + sys.argv[2] + r": \|\n((?:  .*\n|\n)+)", t, re.M)
print("\n".join(l[2:] for l in m.group(1).rstrip().splitlines()) if m else "")' "$1" "$2"; }
  body=$(field "$f" input); follow=$(field "$f" followup)
  # Both arms run in an empty cwd OUTSIDE the repo. Running inside it let the baseline load the
  # repo's own CLAUDE.md ("check whether a relevant skill exists") and read mentor/SKILL.md — the
  # first baseline round reproduced the skill's output template verbatim and had to be discarded.
  local work="$OUT/cwd/$id"; rm -rf "$work"; mkdir -p "$work"
  if [ "$ARM" = skill ]; then
    prompt="/think:mentor $body"
    set -- --plugin-dir "$REPO/think"
  else
    prompt="$body"
    set --
  fi
  # Turn 1 opens (mentor classifies and asks one question by design); turn 2 answers that question
  # and asks for a position, which is where the closing criteria can exist at all. Scoring turn 1
  # against C1/C2/C3/C9/C10 measures a rubric mismatch, not the skill.
  ( cd "$work" && claude -p "$prompt" --model "$MODEL" --output-format json \
      --setting-sources project "$@" \
      < /dev/null > "$OUT/$id.t1.json" 2> "$OUT/$id.stderr" )
  local sid
  sid=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("session_id") or "")' "$OUT/$id.t1.json")
  if [ -n "$sid" ] && [ -n "$follow" ]; then
    ( cd "$work" && claude -p "$follow" --resume "$sid" --model "$MODEL" --output-format json \
        --setting-sources project "$@" \
        < /dev/null > "$OUT/$id.t2.json" 2>> "$OUT/$id.stderr" )
  fi
  python3 - "$OUT" "$id" <<'PYX'
import json, os, sys
d, i = sys.argv[1], sys.argv[2]
def load(n):
    p = f"{d}/{i}.{n}.json"
    return json.load(open(p)) if os.path.exists(p) else {}
t1, t2 = load("t1"), load("t2")
r1 = (t1.get("result") or "").strip(); r2 = (t2.get("result") or "").strip()
open(f"{d}/{i}.txt", "w").write(f"=== TURN 1 ===\n{r1}\n\n=== TURN 2 ===\n{r2}\n")
json.dump({"cost": (t1.get("total_cost_usd") or 0) + (t2.get("total_cost_usd") or 0),
           "t1_chars": len(r1), "t2_chars": len(r2)}, open(f"{d}/{i}.json", "w"))
PYX
  python3 -c '
import json, sys
m = json.load(open(sys.argv[1]))
print("  %-14s $%.3f  t1=%d t2=%d chars" % (sys.argv[2], m["cost"], m["t1_chars"], m["t2_chars"]))
sys.exit(0 if m["t2_chars"] else 1)' "$OUT/$id.json" "$id" \
    || echo "  $id  INCOMPLETE (see $OUT/$id.stderr)"
}
export -f one; export OUT MODEL ARM REPO
printf '%s\n' "${specs[@]}" | xargs -P "${MENTOR_PARALLEL:-3}" -I{} bash -c 'one "$1"' _ {}
echo "arm=$ARM out=$OUT"
