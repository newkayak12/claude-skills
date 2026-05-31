#!/usr/bin/env python3
"""
kill-check.py — Evaluate kill criteria for a cycle.

metrics.json 의 *관측 가능한* 지표만으로 07 §7.5 의 Hard/Soft kill 트리거를 판정한다.

설계 의도: *자동 알람*. 수동 점검은 AP-10 Sunk-cost rescue 로 회피됨.

지표 (cycle-004 — *관측 가능성* 기준으로 정리):
  - session_count   : Computational. SessionStart hook(session-counter.py)이 자동 증가.
                      솔로 개발자 단위 = 작업 세션 (wall-clock 아님 — 방치해도 오탐 없음).
  - reentry_count   : Inferential. 같은 단계 재진입을 게이트/사람이 기록 (의미 판단 필요).
  - ~~time_spent_hours~~ : 제거 — session_count 로 대체.
  - ~~budget_spent_pct~~ : 제거 — 하네스가 *돈 신호를 관측 못 함*. 측정 불가 지표로
                           kill 을 판정하면 *항상-0(거짓 OK)* 의 거짓말 Sensor 가 된다.
                           예산은 사람이 별도 판단 (black box 회고 대상).

Exit codes:
  0 = OK
  1 = SOFT kill (재평가 트리거 — 의식적 결정 필요)
  2 = HARD kill (자동 종료 트리거)
  3 = error (파일 누락 등)

Usage:
  kill-check.py <cycle-id>
  kill-check.py active            # cycles/active symlink 사용
"""
import argparse
import json
import sys
from pathlib import Path

CYCLES_DIR = Path("cycles")

# Hard kill (07 §7.5) — 관측 가능 지표만
HARD_REENTRY = 3            # 같은 단계 재진입 3회 (Inferential 입력)
HARD_SESSION_MULT = 2      # appetite_sessions 의 2배 초과 (= "박스를 두 배 넘김")

# Soft kill (07 §7.5)
SOFT_SESSION_MULT = 1      # appetite_sessions 초과 (= "박스를 넘김")


def resolve_cycle(cycle_arg: str) -> str:
    if cycle_arg == "active":
        link = CYCLES_DIR / "active"
        if not link.exists():
            print("ERROR: no active cycle (cycles/active missing)", file=sys.stderr)
            sys.exit(3)
        return link.resolve().name
    return cycle_arg


def load_metrics(cycle_id: str) -> dict:
    path = CYCLES_DIR / cycle_id / "metrics.json"
    if not path.exists():
        print(f"ERROR: metrics.json not found at {path}", file=sys.stderr)
        sys.exit(3)
    return json.loads(path.read_text(encoding="utf-8"))


def evaluate(cycle_id: str):
    metrics = load_metrics(cycle_id)
    alarms = []   # hard
    warnings = []  # soft

    # 1) 재진입 — Hard (Inferential 입력: 게이트/사람이 기록)
    reentry = metrics.get("reentry_count", 0)
    if reentry >= HARD_REENTRY:
        alarms.append(f"재진입 {reentry}회 ≥ {HARD_REENTRY} (한도 초과)")

    # 2) 세션 카운트 — Hard / Soft (Computational: session-counter.py 가 자동 증가)
    appetite = metrics.get("appetite_sessions")
    sessions = metrics.get("session_count", 0)
    if appetite and appetite > 0:
        if sessions > appetite * HARD_SESSION_MULT:
            alarms.append(
                f"세션 {sessions} > appetite {appetite}×{HARD_SESSION_MULT} "
                f"(박스를 두 배 넘김)"
            )
        elif sessions > appetite * SOFT_SESSION_MULT:
            warnings.append(
                f"세션 {sessions} > appetite {appetite} (박스 초과) — 재평가 트리거"
            )

    return alarms, warnings


def main():
    parser = argparse.ArgumentParser(description="Check kill criteria for a harness cycle")
    parser.add_argument("cycle", help="Cycle ID or 'active'")
    args = parser.parse_args()

    cycle_id = resolve_cycle(args.cycle)
    alarms, warnings = evaluate(cycle_id)

    print(f"=== Kill check: {cycle_id} ===")

    if alarms:
        print()
        print("🛑 HARD KILL — 자동 종료 트리거 발동")
        for a in alarms:
            print(f"  - {a}")
        print()
        print("참조: 07 §7.5 Kill Criteria / C-06 Sunk cost / 11 AP-10 Sunk-cost rescue")
        print()
        print("필수 행동:")
        print("  1. 사이클 즉시 종료")
        print("  2. retro.md 작성 (kill 사유 명시)")
        print("  3. 살림/의심/버림 분류 (07 §7.4)")
        print("  4. 다음 사이클 후보로 *회피 패턴* 등록")
        sys.exit(2)

    if warnings:
        print()
        print("⚠️  SOFT KILL — 재평가 트리거")
        for w in warnings:
            print(f"  - {w}")
        print()
        print("참조: 07 §7.5 Soft kill")
        print()
        print("의식적 결정 필요 (3택):")
        print("  - 계속 진행 (가설 검증 임박 시)")
        print("  - 종료 (가설 미입증 + 재실험 비용 큼)")
        print("  - Pivot (가설 반증 시 — 07 §7.6)")
        print()
        print("결정은 ADR로 기록.")
        sys.exit(1)

    print("✓ OK — 임계값 이내")
    sys.exit(0)


if __name__ == "__main__":
    main()
