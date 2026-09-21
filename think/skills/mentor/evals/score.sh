#!/usr/bin/env bash
# score.sh <arm> — judge every response in one arm against rubric.md. One claude -p per response.
# The judge never sees which arm produced the text.
set -uo pipefail
cd "$(dirname "$0")"
ARM=${1:?arm}
OUT="${MENTOR_OUT:-${TMPDIR:-/tmp}/mentor-bench}/$ARM"
JMODEL="${JUDGE_MODEL:-sonnet}"

judge_one() {
  local id=$1 txt="$OUT/$id.txt" fx
  fx=$(ls fixtures/${id}*.md 2>/dev/null | head -1); [ -f "$fx" ] || fx="fixtures/$id.md"
  [ -s "$txt" ] || { echo "  $id  EMPTY"; return; }
  claude -p "You are scoring one response against a fixed rubric. Be strict and literal.

=== RUBRIC ===
$(cat rubric.md)

=== FIXTURE (the situation the response was answering, plus what it should do) ===
$(cat "$fx")

=== RESPONSE UNDER TEST (two turns of one conversation) ===
$(cat "$txt")

=== YOUR TASK ===
Score C1..C12 as 1, 0, or \"n/a\" per the rubric, applying the F4 inversion and the per-fixture C12
row. A criterion is 1 ONLY if you can quote the exact text that satisfies it — put that quote in
\"evidence\". If you cannot quote it, the score is 0 and evidence explains what was missing.
Do not reward length, fluency, warmth, or sounding wise. Do not infer intent.
A criterion satisfied in either turn scores 1. C7 must hold in each turn separately: if either turn
stacks two or more questions, C7 is 0.

Output ONLY this JSON, no prose, no fences:
{\"id\":\"$id\",\"scores\":{\"C1\":1,...,\"C12\":0},\"evidence\":{\"C1\":\"quote or gap\",...},
 \"total\":N,\"applicable\":M,\"one_line\":\"what this response did, 15 words max\"}" \
    --model "$JMODEL" --output-format json --no-session-persistence --setting-sources project \
    < /dev/null 2>/dev/null \
  | python3 -c '
import json, re, sys
raw = json.load(sys.stdin).get("result") or ""
m = re.search(r"\{.*\}", raw, re.S)
if not m: print("PARSE FAIL", file=sys.stderr); sys.exit(1)
d = json.loads(m.group(0))
json.dump(d, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
print(f"  {d[\"id\"]:<14} {d[\"total\"]}/{d[\"applicable\"]}  {d[\"one_line\"]}")' "$OUT/$id.score.json" \
  || echo "  $id  JUDGE FAIL"
}
export -f judge_one; export OUT JMODEL
ls "$OUT"/*.txt 2>/dev/null | xargs -n1 basename | sed 's/\.txt$//' \
  | xargs -P "${MENTOR_PARALLEL:-3}" -I{} bash -c 'judge_one "$1"' _ {}

python3 - "$OUT" "$ARM" <<'PY'
import glob, json, sys
d, arm = sys.argv[1], sys.argv[2]
rs = [json.load(open(f)) for f in sorted(glob.glob(f"{d}/*.score.json"))]
if not rs: sys.exit("no scores")
T = sum(r["total"] for r in rs); A = sum(r["applicable"] for r in rs)
print(f"\n{arm}: {T}/{A} ({T/A:.0%})")
for r in rs: print(f'  {r["id"]:<16} {r["total"]}/{r["applicable"]}')
crit = {}
for r in rs:
    for k, v in r["scores"].items():
        if v != "n/a": crit.setdefault(k, []).append(int(v))
print("  per-criterion: " + "  ".join(f"{k}={sum(v)}/{len(v)}" for k, v in sorted(crit.items(), key=lambda x: int(x[0][1:]))))
PY
