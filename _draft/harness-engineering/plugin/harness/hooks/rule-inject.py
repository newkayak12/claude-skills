#!/usr/bin/env python3
"""
rule-inject.py — SessionStart hook. effective 룰(L1>L0 머지)을 세션 컨텍스트에 *자동 주입*.

#010이 만든 rule-layering 머지 엔진(rules-merge.py)은 지금까지 *사람이 손으로 돌려 읽는*
반자동이었다 (TODO "룰 자동 injection"). 그래서 effective 룰이 실제로는 컨텍스트에
도달하지 않았다 — 품질저하방지 층들이 가리키는 룰이 모델 눈에 안 들어옴. 이 hook이
세션 시작 시 effective set을 stdout(=컨텍스트 주입)으로 흘려 그 구멍을 메운다.

설계 경계 (중요):
  *주입 ≠ 강제*. 이건 soft 안내다 (원칙1 "지도"). 진짜 불변량 강제는 게이트·PreToolUse
  hook 몫이다 (원칙2). SessionStart는 차단 개념이 없다 — fail-open, exit 0 always.

토큰 경량화 (lossless 포맷 압축):
  주입은 `rules-merge effective`의 *전량 effective*(머지된 L0+L1) 그대로 — **룰을 빼지 않는다**.
  토큰 절감은 포맷에서만 온다: 룰당 3줄(`## id:` + `_layer:_` + 공백) → 1줄(`## id (layer!): title`).
  실측 766→620 토큰(≈19%), 룰 누락 0 → *기능 저해 없음*.

  왜 슬라이싱(정적 L0 default 빼기)을 안 하나:
  독립 리뷰(2026-06-03)가 잡음 — 정적 L0 default를 빼면 그게 곧 코딩 룰(SOLID/KISS/YAGNI/
  DRY/SoC/tech-debt)이고, 빠진 룰을 *작업 단계에서 자동 재주입*하는 메커니즘이 아직 없다
  (stage-entry hook 미구현). "필요하면 --stage로 조회"는 자동 호출자가 없어 실효 없음 →
  코딩 세션에서 코딩 룰이 사라지는 *기능 저해*. 그래서 슬라이싱은 stage-injection 후속까지 보류.
  (`rules-merge effective --dynamic` 플래그는 그 후속의 빌딩블록으로 남겨둠 — 세션 주입엔 미사용.)

  effective가 0이면(=L0 부재/L1 없음) 조용히 종료 — 스팸 금지.

Wiring (hooks.json):
  "SessionStart": [ { "hooks": [ { "type": "command",
    "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/rule-inject.py" } ] } ]

Protocol:
  exit 0 always (세션을 막지 않는다). stdout = 컨텍스트 주입. effective 0 또는 머지 엔진
  부재 시 무출력(fail-open).
"""
import os
import subprocess
import sys
from pathlib import Path

BOUNDARY = (
    "[harness] 적용 룰 자동 주입 (L1>L0 effective · 안내일 뿐 — "
    "진짜 강제는 게이트/PreToolUse hook, 원칙2):"
)


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
        [sys.executable, str(merge), "effective"],
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
