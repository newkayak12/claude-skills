#!/usr/bin/env python3
"""
deploy-kill-check.py — UserPromptSubmit hook (Computational Sensor, *차단*).

사용자가 "배포/deploy" 의도를 표명하면 active 사이클에 kill-check 를 돌려,
Hard kill 상태면 *배포 프롬프트 자체를 차단*한다 (exit 2).

이것이 `13 §3` 의 "이거 배포하자 → UserPromptSubmit → kill-check.py → Hard면 차단"
설계의 실제 wiring. C-06 Sunk-cost / AP-10 Sunk-cost rescue 를 *물리적*으로 방어:
죽었어야 할 사이클을 배포로 밀어붙이는 걸 막는다.

선행: cycle-004 가 metrics 를 정직화(session_count 자동 측정)해 kill-check 가
실제 데이터로 판정 가능해진 뒤에야 이 Sensor 가 의미를 가진다.

판정 매핑 (kill-check exit → 이 hook):
  0 (ok)   → exit 0, 짧은 확인
  1 (soft) → exit 0 + 경고 컨텍스트 (재평가 트리거 — *차단 아님*, 의식적 결정은 사람)
  2 (hard) → exit 2, stderr 차단 메시지 (배포 프롬프트 차단)
  3 (err)  → exit 0 (fail-open — active 없음/파일 누락 시 막지 않는다)

Wiring (hooks.json):
  "UserPromptSubmit": [ { "hooks": [ { "type": "command",
    "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/deploy-kill-check.py" } ] } ]

Protocol:
  deploy 키워드 없으면 exit 0 silent (일반 프롬프트를 막지 않는다).
  stdin JSON 파싱 실패 → exit 0 (fail-open).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

CYCLES = Path("cycles")
ACTIVE = CYCLES / "active"

# 배포 의도 키워드 — 한글 직접 매칭 + 영문 소문자 매칭
DEPLOY_KEYWORDS = ("배포", "출시", "릴리즈", "deploy", "release", "ship it", "go live", "프로덕션 올")


def read_prompt() -> str:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return ""
    return data.get("prompt", "") if isinstance(data, dict) else ""


def is_deploy_intent(prompt: str) -> bool:
    low = prompt.lower()
    return any(kw in prompt or kw in low for kw in DEPLOY_KEYWORDS)


def kill_check_script():
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    candidates = []
    if root:
        candidates.append(Path(root) / "scripts" / "kill-check.py")
    candidates.append(Path(__file__).resolve().parent.parent / "scripts" / "kill-check.py")
    for c in candidates:
        if c.exists():
            return c
    return None


def main():
    prompt = read_prompt()
    if not is_deploy_intent(prompt):
        sys.exit(0)  # 일반 프롬프트 — 간섭하지 않는다

    if not ACTIVE.exists():
        sys.exit(0)  # active 사이클 없음 — kill 대상 없음 (fail-open)

    script = kill_check_script()
    if script is None:
        sys.exit(0)  # 스크립트 못 찾음 — 막지 않는다 (fail-open)

    result = subprocess.run(
        [sys.executable, str(script), "active"],
        capture_output=True,
        text=True,
    )
    detail = result.stdout.strip()

    if result.returncode == 2:
        # Hard kill — 배포 프롬프트 차단
        print(
            "[harness] 🛑 배포 차단 — active 사이클이 HARD KILL 상태입니다.\n"
            f"{detail}\n"
            "이 사이클은 *죽었어야* 합니다 (07 §7.5 / C-06 Sunk cost). "
            "배포 전에 retro(kill 사유) 작성 후 사이클을 종료하세요. "
            "강행하려면 kill 기준을 ADR로 조정하거나 사이클을 명시적으로 닫고 새로 여세요.",
            file=sys.stderr,
        )
        sys.exit(2)

    if result.returncode == 1:
        # Soft kill — 경고만 (차단 아님, 결정은 사람)
        print(
            "[harness] ⚠️  배포 전 재평가 트리거 (SOFT kill).\n"
            f"{detail}\n"
            "계속 / 종료 / pivot 을 의식적으로 결정하세요 (결정은 ADR)."
        )
        sys.exit(0)

    if result.returncode == 0:
        print("[harness] kill-check ok — 배포 게이트 통과 (임계값 이내).")
        sys.exit(0)

    # returncode 3 등 — fail-open
    sys.exit(0)


if __name__ == "__main__":
    main()
