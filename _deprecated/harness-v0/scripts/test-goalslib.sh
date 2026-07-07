#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../.." || exit 1
P="python3 harness/scripts/goalslib.py --selftest"
fail=0
$P || { echo "FAIL: goalslib --selftest 비-0"; fail=1; }
[ $fail -eq 0 ] && echo "goalslib self-test: PASS"
exit $fail
