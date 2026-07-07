#!/usr/bin/env bash
set -u
cd "$(dirname "$0")" || exit 1   # hooks 디렉토리
G="python3 active-symlink-guard.py"
fail=0

expect() { # $1=기대exit  $2=stdin
  echo "$2" | $G >/dev/null 2>&1; rc=$?
  [ "$rc" -eq "$1" ] || { echo "FAIL: exit=$rc(기대 $1) — $2"; fail=1; }
}

# 차단(2): symlink 자체 제거
expect 2 '{"tool_name":"Bash","tool_input":{"command":"rm cycles/active"}}'
expect 2 '{"tool_name":"Bash","tool_input":{"command":"unlink cycles/active"}}'
expect 2 '{"tool_name":"Bash","tool_input":{"command":"rm -f cycles/active && echo done"}}'
# 통과(0): 무관 / 하위 경로 / 정당 경로 / 다른 도구
expect 0 '{"tool_name":"Bash","tool_input":{"command":"rm cycles/active/tmp.txt"}}'
expect 0 '{"tool_name":"Bash","tool_input":{"command":"ls cycles/active"}}'
expect 0 '{"tool_name":"Bash","tool_input":{"command":"python3 plugin/harness/scripts/close-cycle.py"}}'
expect 0 '{"tool_name":"Edit","tool_input":{"file_path":"x"}}'
# fail-open: 깨진 JSON → 통과
expect 0 'not json'

[ $fail -eq 0 ] && echo "active-symlink-guard self-test: PASS"
exit $fail
