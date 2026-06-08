#!/usr/bin/env python3
"""
ratchet-check.py — Cross-cycle quality ratchet CLI (#008 quality-floor ③).

#006 이 *한 사이클* 안의 바 낮추기를, #007 이 *바 충족*을 강제했다면,
#008 은 *바가 사이클을 넘어 낮아지지 않음*을 강제한다(cross-cycle 단조 비감소).

close-cycle.py 가 게이트로 ratchetlib.find_regressions 를 호출 — 이 CLI 는 사람이
바닥(floor)을 보거나, close 전에 미리 회귀를 점검하는 용도.

Usage:
  ratchet-check.py check --cycle <id>   # 회귀 있으면 exit 2, 없으면 0
  ratchet-check.py floor                # 현재 닫힌 사이클들의 축별 watermark
  ratchet-check.py axes  --cycle <id>   # 이 사이클이 선언한 축

Exit:
  0 = 회귀 없음
  2 = 회귀 탐지
  1 = 사용 오류
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ratchetlib  # noqa: E402


def cmd_check(args):
    cdir = ratchetlib.CYCLES / args.cycle
    if not cdir.exists():
        print(f"ERROR: cycle directory not found: {cdir}", file=sys.stderr)
        sys.exit(1)
    regs = ratchetlib.find_regressions(args.cycle)
    if not regs:
        floor = ratchetlib.compute_floor(exclude=args.cycle)
        declared = ratchetlib.best_declared(cdir)
        print(f"OK — ratchet 회귀 없음 (선언 축 {len(declared)}개, 이전 watermark 축 {len(floor)}개)")
        sys.exit(0)
    print("🛑 RATCHET 회귀 — cross-cycle 품질 바닥보다 낮음:", file=sys.stderr)
    for r in regs:
        print(f"  - axis '{r['axis']}': 현재 {r['current']} vs floor {r['floor']} "
              f"({r['direction']}, {r['source']}) — {r['reason']}", file=sys.stderr)
    print("  올리거나(같은 축 더 나은 값 잠금) 의도된 회귀면 close --force + ADR.", file=sys.stderr)
    sys.exit(2)


def cmd_floor(args):
    floor = ratchetlib.compute_floor()
    if not floor:
        print("(닫힌 사이클에 축 watermark 없음 — ratchet 비활성)")
        return
    for axis, v in sorted(floor.items()):
        tag = "  [baseline-reset]" if v.get("baseline_reset") else ""
        print(f"[{axis}] {v['value']} ({v['direction']}) ← {v['source']}{tag}")


def cmd_axes(args):
    cdir = ratchetlib.CYCLES / args.cycle
    if not cdir.exists():
        print(f"ERROR: cycle directory not found: {cdir}", file=sys.stderr)
        sys.exit(1)
    declared = ratchetlib.best_declared(cdir)
    if not declared:
        print("(이 사이클은 축을 선언하지 않음 — ratchet 대상 아님)")
        return
    for axis, v in sorted(declared.items()):
        print(f"[{axis}] {v['value']} ({v['direction']})")


def main():
    parser = argparse.ArgumentParser(description="Cross-cycle quality ratchet (#008)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    pc = sub.add_parser("check", help="현재 사이클의 선언 축이 회귀하는지 점검")
    pc.add_argument("--cycle", required=True)
    pc.set_defaults(func=cmd_check)

    pf = sub.add_parser("floor", help="닫힌 사이클들의 축별 watermark 출력")
    pf.set_defaults(func=cmd_floor)

    pa = sub.add_parser("axes", help="이 사이클이 선언한 축 출력")
    pa.add_argument("--cycle", required=True)
    pa.set_defaults(func=cmd_axes)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
