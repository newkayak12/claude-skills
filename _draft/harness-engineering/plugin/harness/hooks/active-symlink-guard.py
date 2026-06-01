#!/usr/bin/env python3
"""
active-symlink-guard.py — PreToolUse hook (Böckeler Sensor, Computational, 차단).

cycles/active symlink 를 Bash 로 직접 제거(rm/unlink)하려는 시도를 차단한다.
사이클 종료는 close-cycle.py 만이 정당 경로 — 그 안에서 품질 게이트(독립 리뷰 충족)를
통과해야 active 가 풀린다. 수동 rm 으로 게이트를 우회하는 길을 막는다 (#007 Full Computational).

bar.jsonl 보호 hook(hypothesis-immutability)과 *대칭*: 데이터(바)뿐 아니라
종료 행위(symlink 제거)도 정당 스크립트로만.

정직한 한계: Bash 의 rm/unlink 만, 그리고 cycles/active *그 자체*(하위 경로 아님)만 탐지.
mv · python os.unlink · find -delete · 'rm -rf cycles/active/'(후행 슬래시) 는 못 잡는다.
close-cycle.py 는 *in-process* 로 unlink 하므로 이 hook 의 대상이 아니다 (정당).

Wiring (hooks.json):
  "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command",
    "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/active-symlink-guard.py" } ] } ]

Protocol:
  exit 0 = allow, exit 2 = block. stdin JSON 파싱 실패 → exit 0 (fail-open).
"""
import json
import re
import sys

# rm 또는 unlink 가 cycles/active 를 (그 자체로 — 하위 경로 '/' 아님) 대상으로 할 때
PATTERN = re.compile(r"\b(rm|unlink)\b[^\n]*\bcycles/active(?![\w/])")


def main():
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)  # fail-open

    if not isinstance(event, dict) or event.get("tool_name") != "Bash":
        sys.exit(0)
    command = (event.get("tool_input") or {}).get("command", "")
    if not isinstance(command, str):
        sys.exit(0)

    if PATTERN.search(command):
        sys.stderr.write(
            "BLOCKED: cycles/active 를 수동 제거(rm/unlink)할 수 없습니다.\n"
            "  사이클 종료는 품질 게이트를 통과하는 close-cycle.py 만이 정당 경로:\n"
            "    python3 ${CLAUDE_PLUGIN_ROOT}/scripts/close-cycle.py\n"
            "  (독립 리뷰 verdict=pass 가 모든 바 기준에 없으면 종료가 거부됩니다 — #007.)\n"
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
