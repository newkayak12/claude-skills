#!/usr/bin/env python3
"""
kill-check.py — Evaluate kill criteria for a cycle.

cycles/<id>/cycle-card.md 임계값 + metrics.json 현재 상태 비교 →
07 §7.5의 Hard/Soft kill 트리거 발동 여부 판정.

설계 의도: *자동 알람*. 수동 점검은 AP-10 Sunk-cost rescue로 회피됨.

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
import re
import sys
from pathlib import Path

CYCLES_DIR = Path("cycles")

# Default thresholds (07 §7.5 — Hard kill)
HARD_REENTRY = 3
HARD_TIME_PCT = 200
HARD_BUDGET_PCT = 100

# Soft kill (07 §7.5)
SOFT_TIME_PCT = 150


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


def parse_time_budget_weeks(cycle_id: str):
    path = CYCLES_DIR / cycle_id / "cycle-card.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    m = re.search(r"Time budget\s*\|\s*(\d+(?:\.\d+)?)\s*weeks?", text)
    return float(m.group(1)) if m else None


def evaluate(cycle_id: str):
    metrics = load_metrics(cycle_id)
    alarms = []   # hard
    warnings = []  # soft

    # 1) 재진입 — Hard
    reentry = metrics.get("reentry_count", 0)
    if reentry >= HARD_REENTRY:
        alarms.append(f"재진입 {reentry}회 ≥ {HARD_REENTRY} (한도 초과)")

    # 2) 시간 — Hard / Soft
    budget_weeks = parse_time_budget_weeks(cycle_id)
    if budget_weeks and budget_weeks > 0:
        # 8h/day, 5d/week 가정 — 1인 개발자
        budget_hours = budget_weeks * 5 * 8
        spent = metrics.get("time_spent_hours", 0)
        pct = (spent / budget_hours) * 100
        if pct >= HARD_TIME_PCT:
            alarms.append(f"시간 {pct:.0f}% ≥ {HARD_TIME_PCT}% ({spent:.0f}/{budget_hours:.0f}h)")
        elif pct >= SOFT_TIME_PCT:
            warnings.append(f"시간 {pct:.0f}% ≥ {SOFT_TIME_PCT}% — 재평가 트리거")

    # 3) 예산 — Hard
    budget_pct = metrics.get("budget_spent_pct", 0)
    if budget_pct >= HARD_BUDGET_PCT:
        alarms.append(f"예산 {budget_pct}% ≥ {HARD_BUDGET_PCT}%")

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
