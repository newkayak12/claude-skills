#!/usr/bin/env python3
"""
rule-inject.py — SessionStart hook. *항상 켜둘* 룰(invariant L0 + L1)을 세션 컨텍스트에 주입.

#010이 만든 rule-layering 머지 엔진(rules-merge.py)은 지금까지 *사람이 손으로 돌려 읽는*
반자동이었다 (TODO "룰 자동 injection"). 그래서 effective 룰이 실제로는 컨텍스트에
도달하지 않았다 — 품질저하방지 층들이 가리키는 룰이 모델 눈에 안 들어옴. 이 hook이
세션 시작 시 그 구멍을 메운다.

분업 (stage-inject 와의 역할 분리 — review/2026-06-03 CA-10/PF-10):
  - rule-inject (이 hook, SessionStart): *항상·전 단계에서 켜둘* 룰만 — invariant L0(R-PG/
    R-DoD/R-DD/R-AI 등 `(필수)` 섹션) + L1/L2/L3(사용자/프로젝트/사이클). = `--dynamic`.
    이건 단계와 무관하게 세션 내내 유효하므로 시작에 1회 쏜다.
  - stage-inject (PreToolUse, 단계 진입): *단계별* 룰(R-CD 코딩 룰·R-AR 아키텍처 룰 등 정적
    L0 default)을 *그 단계가 시작되는 순간* 쏜다. 코딩이 시작될 때(Edit/Write) R-CD 가 도착.

  왜 SessionStart 를 `--dynamic`으로 슬림했나 (예전엔 전량 effective):
  예전 주석은 "정적 L0 default 슬라이싱 = 기능저해(코딩 룰 사라짐)"라 보류했다. 그 전제는
  *빠진 룰을 단계에서 재주입하는 메커니즘이 없다*는 것이었다. stage-inject.py 가 그 메커니즘이다
  — 코딩 룰은 이제 *코딩 시작 시점*에 stage-inject 가 재주입한다. 따라서 슬라이싱은 더 이상
  기능저해가 아니다: 모든 코딩 룰은 여전히 모델에 도달한다, 다만 *세션 시작*이 아니라 *단계 진입*에.
  순효과: SessionStart 토큰 ↓(45룰→invariant+L1 ≈20룰) **AND** 방어가 경계→플로우 내부로 확장.

토큰 경량화 (lossless 포맷 압축은 그대로):
  주입 포맷은 룰당 1줄(`## id (layer!): title`) — verbose 3줄 대비 압축. 단계 슬라이싱과
  포맷 압축은 *직교*다 (둘 다 적용). invariant+L1 은 전부 그대로 주입 — 이 슬라이스 안에서 룰
  누락 0. (제외된 정적 default 는 stage-inject 가 단계에서 커버 → 전체 기능 보존.)

  --dynamic 결과가 0이면(=invariant 부재·L1 없음) 조용히 종료 — 스팸 금지.

Wiring (hooks.json):
  "SessionStart": [ { "hooks": [ { "type": "command",
    "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/rule-inject.py" } ] } ]

설계 경계 (중요):
  *주입 ≠ 강제*. 이건 soft 안내다 (원칙1 "지도"). 진짜 불변량 강제는 게이트·차단성 PreToolUse
  hook 몫이다 (원칙2). SessionStart는 차단 개념이 없다 — fail-open, exit 0 always.

Protocol:
  exit 0 always (세션을 막지 않는다). stdout = 컨텍스트 주입. --dynamic 0 또는 머지 엔진
  부재 시 무출력(fail-open).
"""
import os
import subprocess
import sys
from pathlib import Path

BOUNDARY = "[harness] 항상-켜둘 룰 자동 주입 (안내일 뿐 — 진짜 강제는 게이트/차단성 hook):"


def find_script(name: str):
    """active-cycle-verify.py 와 동일한 해석: CLAUDE_PLUGIN_ROOT 우선, 그다음 상대."""
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
    merge = find_script("rules-merge.py")
    if merge is None:
        sys.exit(0)  # fail-open — 머지 엔진 못 찾으면 세션 막지 않는다

    result = subprocess.run(
        [sys.executable, str(merge), "effective", "--dynamic"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        sys.exit(0)  # fail-open — 차단성 충돌 등은 conflicts 가 따로 다룸

    body = result.stdout.strip()
    # rules-merge 는 effective 0 일 때 "(0 effective ...)" 헤더만 출력 → 주입할 룰 없음.
    if not body or "(0 effective" in body:
        sys.exit(0)  # 스팸 금지

    print(BOUNDARY)
    print(body)
    sys.exit(0)


if __name__ == "__main__":
    main()
