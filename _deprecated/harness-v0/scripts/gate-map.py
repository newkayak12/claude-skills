#!/usr/bin/env python3
"""
gate-map.py — 사전사이클 게이트의 *배치입력* 매퍼/검증기 (real-use feedback #1·#2).

문제: 사용자가 게이트 컨텍스트를 한 번에 쏟아도, AI 가 A~E 를 한 군씩 다시 물으면
경험이 나쁘다(#1). 또 Exploration 타입은 Kill 기준이 사이클 중 구체화되는데 초기에 강제
확정시키는 건 형식주의(#2). 두 행동 모두 cycle/SKILL.md 에 prose 로 적혀 있으나 *강제되지
않아* 06-23 실사용에서 재발했다.

이 스크립트는 그 대화 행동을 *결정적 산출*로 경화한다:
  - AI 가 context-dump 를 A~E 로 *의미 매핑*(LLM 역할)해 --a..--e 로 넘긴다.
  - 스크립트는 (1) 어느 그룹이 비었는지 (2) "빠진 것만" 물을 리스트 (3) 매트릭스
    pre-verdict — 특히 C/Kill defer 규칙 — 를 *코드로* 산출한다.

정직한 한계: NLP 안 한다. 매핑이 틀려도 스크립트는 모른다. 강제하는 건 "빈 그룹 +
Exploration Kill defer 규칙"의 결정적 산출뿐. 최종 Go/No-go 판단은 여전히 대화 몫.

Usage:
  gate-map.py --type product|dev-tool|exploration \\
      --a "problem statement..." --b "..." --c "...kill..." --d "..." --e "..."
  (각 항목 생략·공백 허용 — 생략된 그룹이 '누락'으로 잡힌다)

Exit: 0 always (이건 안내 산출이지 게이트 차단이 아니다 — 차단은 cycle-init/phase-advance).
"""
import argparse
import sys

# 게이트 그룹 — cycle/SKILL.md Step 2 의 A~E 와 *일치*시킨다.
GROUPS = [
    ("a", "A. Idea (problem-first)",
     "문제 진술('users cannot do X')·Persona·빈도×강도·현 대안·솔루션 과몰입 self-check"),
    ("b", "B. Strategic fit",
     "직전 사이클 학습 정합·현 강점 레버리지·운영 제품과 충돌(WIP=1)"),
    ("c", "C. Cost · time (Kill 포함)",
     "시간 예산·돈 예산·현 역량으로 완수 가능·**Kill 기준** 사전 정의"),
    ("d", "D. Verifiability",
     "Gate1 통과 가능성·검증 대상 접근(Product:인터뷰5 / Dev-tool:self / Exploration:학습)·반증 가능 형태"),
    ("e", "E. Self-check",
     "진짜 동기(호기심/도피/외압/기회?)·6개월 후 후회 시나리오·안 하면 더 나빠지는가"),
]

KILL_HINTS = ("kill", "킬", "중단 기준", "중단기준")


def _filled(v: str) -> bool:
    return bool(v and v.strip())


def _has_kill(c_text: str) -> bool:
    low = (c_text or "").lower()
    return any(h in low for h in KILL_HINTS)


def main():
    ap = argparse.ArgumentParser(description="pre-cycle 게이트 배치입력 매퍼/검증기")
    ap.add_argument("--type", required=True,
                    choices=["product", "dev-tool", "exploration"])
    for key, _, _ in GROUPS:
        ap.add_argument(f"--{key}", default="", help=f"게이트 그룹 {key.upper()} 매핑 텍스트")
    args = ap.parse_args()

    values = {key: getattr(args, key) for key, _, _ in GROUPS}
    filled = {key: _filled(v) for key, v in values.items()}
    missing = [key for key, _, _ in GROUPS if not filled[key]]

    print(f"=== Gate map (type: {args.type}) ===")
    for key, label, _ in GROUPS:
        mark = "✓ filled" if filled[key] else "✗ missing"
        print(f"  {label:32} : {mark}")
    print()

    # C 내부의 Kill 기준 별도 추적 (#2 의 핵심).
    c_present = filled["c"]
    kill_present = c_present and _has_kill(values["c"])
    print(f"Kill: {'present' if kill_present else 'NOT detected in C'}")
    print(f"MISSING: {'none' if not missing else ', '.join(k.upper() for k in missing)}")
    print()

    # ── 빠진 것만 물어라 (#1: 한 군씩 전부 재질문 금지) ──
    if missing:
        print("ASK ONLY THESE (채워진 그룹은 다시 묻지 말 것):")
        for key, label, prompt in GROUPS:
            if key in missing:
                print(f"  {label} — {prompt}")
        print()

    # ── 매트릭스 pre-verdict (cycle/SKILL.md Step 3) ──
    print("VERDICT HINT:")
    verdict_stop = False

    if not filled["a"]:
        print("  - STOP: 문제 진술(A) 없음 — 'I want to build Y' 솔루션 쇼핑 위험. 문제로 돌아갈 것.")
        verdict_stop = True

    if not c_present:
        print("  - STOP: C(비용·시간) 미입력 — 최소한 시간 예산은 지금 확정해야 한다.")
        verdict_stop = True
    elif not kill_present:
        if args.type == "exploration":
            print("  - DEFER 허용: Exploration 은 domain Kill 을 'TBD'(cycle-card TODO)로 미룰 수 있다. "
                  "단 세션 Hard/Soft Kill(템플릿 기본)·시간 예산은 유지, close gate 전 확정 필수.")
        else:
            print(f"  - STOP: {args.type} 은 Kill 기준을 *지금* 확정해야 한다(defer 불가). "
                  "C 에 Kill 라인을 추가하라.")
            verdict_stop = True

    if not filled["d"]:
        print("  - 주의: D(검증 가능성) 누락 — 반증 가능 형태/검증 대상 접근을 채워야 Go 판단 가능.")

    if not verdict_stop and filled["a"] and filled["d"]:
        print("  - proceed-eligible: A·D 충족. 남은 누락만 채우면 Go 판단 가능.")
    elif not verdict_stop:
        print("  - 보류: 치명 STOP 은 없으나 누락 그룹을 먼저 채울 것.")

    sys.exit(0)


if __name__ == "__main__":
    main()
