#!/usr/bin/env python3
"""
active-cycle-verify.py — SessionStart hook (Böckeler *Sensor*, detection).

active 사이클의 append-only 체인(hypotheses.jsonl, bar.jsonl, review.jsonl)을
세션 시작 시 verify 한다. PreToolUse hook 들은 *도구 호출*만 가로채므로
세션 *밖*(에디터 직접 수정)의 변조는 못 막는다 — 그 구멍을 이 hook 이
*다음 세션 시작 시 탐지*로 메운다 (cycle-002 F2, #007 F5: bar·review 확장).

차단이 아니라 *경고*다 (SessionStart 는 차단 개념이 없다). stdout 은 컨텍스트로
주입되어 모델/사용자가 변조를 인지한다.

Wiring (hooks.json):
  "SessionStart": [ { "hooks": [ { "type": "command",
    "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/active-cycle-verify.py" } ] } ]

Protocol:
  exit 0 always (세션 시작을 막지 않는다). stdout = 컨텍스트 주입.
"""
import os
import subprocess
import sys
from pathlib import Path

CYCLES = Path("cycles")
ACTIVE = CYCLES / "active"

# (체인 파일, 검증 스크립트, 사람이 읽을 라벨)
CHAINS = [
    ("hypotheses.jsonl", "hypothesis-register.py", "hypothesis"),
    ("bar.jsonl", "bar-register.py", "bar"),
    ("review.jsonl", "review-register.py", "review"),
]


def find_script(name: str):
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    candidates = []
    if root:
        candidates.append(Path(root) / "scripts" / name)
    candidates.append(Path(__file__).resolve().parent.parent / "scripts" / name)
    for c in candidates:
        if c.exists():
            return c
    return None


def main():
    if not ACTIVE.exists():
        sys.exit(0)

    cycle_id = Path(os.readlink(ACTIVE) if ACTIVE.is_symlink() else ACTIVE.name).name
    cdir = CYCLES / cycle_id

    checked = []
    problems = []
    for fname, script_name, label in CHAINS:
        f = cdir / fname
        if not f.exists() or f.stat().st_size == 0:
            continue  # 등록된 항목 없음 — 검증 대상 아님
        script = find_script(script_name)
        if script is None:
            continue  # fail-open — 스크립트 못 찾으면 세션 막지 않는다
        result = subprocess.run(
            [sys.executable, str(script), "verify", "--cycle", cycle_id],
            capture_output=True, text=True,
        )
        checked.append(label)
        if result.returncode != 0:
            problems.append((label, (result.stdout + result.stderr).strip()))

    if not checked:
        sys.exit(0)

    if not problems:
        print(f"[harness] active cycle '{cycle_id}': {', '.join(checked)} chain(s) intact.")
    else:
        lines = [f"[harness] ⚠️  WARNING: active cycle '{cycle_id}' chain verify FAILED:"]
        for label, detail in problems:
            lines.append(f"  - {label}: {detail}")
        lines.append(
            "  세션 밖에서 변조됐을 수 있다 (AP-06 / #006 바 낮추기). "
            "변조를 black box 에 기록하거나 원본을 복구할 것. 변경은 *새 ID 재등록 + ADR*."
        )
        print("\n".join(lines))

    sys.exit(0)


if __name__ == "__main__":
    main()
