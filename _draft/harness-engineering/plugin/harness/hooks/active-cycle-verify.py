#!/usr/bin/env python3
"""
active-cycle-verify.py — SessionStart hook (Böckeler *Sensor*, detection).

active 사이클의 가설 chain(hypotheses.jsonl)을 세션 시작 시 verify 한다.
PreToolUse hook(hypothesis-immutability)은 *도구 호출*만 가로채므로
세션 *밖*(에디터로 직접 수정)에서의 변조는 못 막는다 — 그 구멍을 이 hook 이
*다음 세션 시작 시 탐지*로 메운다 (cycle-002 F2).

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


def register_script() -> Path | None:
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    candidates = []
    if root:
        candidates.append(Path(root) / "scripts" / "hypothesis-register.py")
    # 이 hook 파일 기준 상대 경로 (plugin/harness/hooks/ → ../scripts/)
    candidates.append(Path(__file__).resolve().parent.parent / "scripts" / "hypothesis-register.py")
    for c in candidates:
        if c.exists():
            return c
    return None


def main():
    # active 사이클 없으면 조용히 통과
    if not ACTIVE.exists():
        sys.exit(0)

    cycle_id = os.readlink(ACTIVE) if ACTIVE.is_symlink() else ACTIVE.name
    cycle_id = Path(cycle_id).name

    hyp = CYCLES / cycle_id / "hypotheses.jsonl"
    if not hyp.exists() or hyp.stat().st_size == 0:
        sys.exit(0)  # 등록된 가설 없음 — 검증 대상 없음

    script = register_script()
    if script is None:
        # 스크립트를 못 찾으면 조용히 통과 (fail-open — 세션을 막지 않는다)
        sys.exit(0)

    result = subprocess.run(
        [sys.executable, str(script), "verify", "--cycle", cycle_id],
        capture_output=True,
        text=True,
    )

    if result.returncode == 0:
        # intact — 짧은 확인만 (노이즈 최소화)
        print(f"[harness] active cycle '{cycle_id}': hypothesis chain intact.")
    else:
        # 변조 탐지 — 경고를 컨텍스트로 주입
        print(
            f"[harness] ⚠️  WARNING: active cycle '{cycle_id}' hypothesis chain FAILED verify.\n"
            f"  세션 밖에서 hypotheses.jsonl 이 변조됐을 수 있다 (AP-06).\n"
            f"  {result.stdout.strip()}\n"
            f"  대응: 변조를 인정하고 black box 에 기록하거나, 원본을 복구할 것. "
            f"가설은 *새 ID 재등록 + ADR* 로만 바꾼다."
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
