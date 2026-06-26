#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../.." || exit 1
R="$(mktemp -d)"
S="python3 harness/scripts/goals-state.py"
fail=0

$S init --root "$R" --final-goal "ship X" --spec ".claude/harness/specs/x.md" >/dev/null || { echo "FAIL: init"; fail=1; }
$S add-goal --root "$R" --id G001 --title "build api" --accept "200 on /health" --hint "develop:clean-code" >/dev/null || { echo "FAIL: add-goal"; fail=1; }
$S set-status --root "$R" --id G001 --status running >/dev/null || { echo "FAIL: set-status"; fail=1; }
out=$($S bump-attempt --root "$R" --id G001); [ "$out" = "1" ] || { echo "FAIL: bump-attempt!=1 ($out)"; fail=1; }
$S scaffold-cycle --root "$R" --id G001 >/dev/null || { echo "FAIL: scaffold"; fail=1; }
for f in plan.md critic-review.md work-evidence.md verification.md rationale.md status.json; do
  [ -f "$R/goal-cycles/G001/$f" ] || { echo "FAIL: missing $f"; fail=1; }
done
grep -q '"status": "running"' "$R/goals.json" || { echo "FAIL: status not persisted"; fail=1; }

rm -rf "$R"
[ $fail -eq 0 ] && echo "goals-state self-test: PASS"
exit $fail
