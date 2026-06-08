#!/usr/bin/env python3
"""
bar-register.py — Pre-registration of the *quality bar* with a tamper-evident hash chain.

사이클 시작 시 품질 기준(gate 임계 / DoD / stage별 필수 리뷰)을 bar.jsonl 에 등록한다.
가설(hypothesis-register.py)과 동일한 chainlog — 사후에 바를 *낮추면* verify 가 탐지.
이것이 "지친 에이전트가 중간에 바를 낮추는" 품질 저하 경로의 물리적 방지선 (#006).
#007(독립 리뷰)·#008(ratchet)이 각 항목의 stage·measure 를 소비한다.

Usage:
  bar-register.py register --cycle <id> --id <Bn> \\
      --criterion "..." --stage <plan|build|test|close|*> --measure "..." \\
      [--axis <name> --value <num> --direction <higher_better|lower_better> [--baseline-reset]]
  bar-register.py verify --cycle <id>
  bar-register.py list   --cycle <id>

축 메타(--axis/--value/--direction)는 *선택적*. 주면 #008 ratchet 이 그 축을 사이클을
넘어 비교(단조 비감소 강제). 안 주면 자유텍스트 바로 남아 cross-cycle 비교 대상 아님.
--baseline-reset 는 그 축의 이전 watermark 를 *대체*(accept-new-baseline, F3) — 빼기
불가능한데 정당하게 회귀해야 하는 축을 표현. 명시·immutable·pass 리뷰가 게이트.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chainlog  # noqa: E402

CYCLES_DIR = Path("cycles")
STAGES = ("plan", "build", "test", "close", "*")
DIRECTIONS = ("higher_better", "lower_better")  # #008 ratchet 축 방향


def bar_file(cycle_id: str) -> Path:
    return CYCLES_DIR / cycle_id / "bar.jsonl"


def cmd_register(args):
    cdir = CYCLES_DIR / args.cycle
    if not cdir.exists():
        print(f"ERROR: cycle directory not found: {cdir}", file=sys.stderr)
        sys.exit(1)
    # 중복 id 거부 — 같은 cycle 에서 한 기준을 두 번 등록(바 낮추기 통로) 차단.
    # 기준 변경은 *새 ID*로만 (silent lowering 방지, #007). 추가는 바를 높이는 방향.
    existing = bar_file(args.cycle)
    if existing.exists():
        for line in existing.read_text(encoding="utf-8").splitlines():
            if line.strip() and json.loads(line).get("id") == args.id:
                print(
                    f"ERROR: bar id '{args.id}' 이미 등록됨 (cycle {args.cycle}). "
                    f"기준 변경은 *새 ID*로 — 같은 id 재등록은 바 낮추기 통로라 거부됩니다.",
                    file=sys.stderr,
                )
                sys.exit(1)
    fields = {
        "id": args.id,
        "criterion": args.criterion,
        "stage": args.stage,
        "measure": args.measure,
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }
    # 축 메타(#008 ratchet)는 *선택적* — all-or-nothing. 없으면 키 자체를 안 넣어
    # 축 없는 바의 엔트리 모양/해시를 #008 이전과 동일하게 유지(하위호환).
    if args.axis is not None or args.value is not None or args.direction is not None:
        if args.axis is None or args.value is None or args.direction is None:
            print("ERROR: 축 메타는 --axis/--value/--direction 을 *모두* 줘야 합니다 "
                  "(ratchet 비교의 안정 축).", file=sys.stderr)
            sys.exit(1)
        fields["axis"] = args.axis
        fields["value"] = args.value
        fields["direction"] = args.direction
        # accept-new-baseline (F3): 이 축 바가 이전 watermark 를 *대체*함을 선언.
        # 빼기 불가능한데 정당하게 회귀(예: mechanism-count +1)할 때만. 명시·리뷰·체인이 게이트.
        if args.baseline_reset:
            fields["baseline_reset"] = True
    elif args.baseline_reset:
        print("ERROR: --baseline-reset 는 축 메타(--axis/--value/--direction)와 함께만 의미 있음 "
              "(ratchet 축이 없는 바는 cross-cycle 비교 대상이 아님).", file=sys.stderr)
        sys.exit(1)
    entry = chainlog.append_entry(bar_file(args.cycle), fields)
    print(f"REGISTERED bar [{args.id}] stage={args.stage} in cycle {args.cycle}")
    print(f"  criterion: {args.criterion}")
    print(f"  measure:   {args.measure}")
    if "axis" in fields:
        tag = " baseline-reset" if fields.get("baseline_reset") else ""
        print(f"  axis:      {args.axis} = {args.value} ({args.direction})  [#008 ratchet{tag}]")
    print(f"  hash: {entry['hash'][:16]}...")
    print()
    print("주의: 이 항목을 *수정*(바 낮추기)하면 verify에서 탐지됨.")
    print("      기준 변경이 필요하면 *새 ID*로 재등록 + ADR.")


def cmd_verify(args):
    ok, count, err = chainlog.verify_chain(bar_file(args.cycle))
    if ok:
        print(f"OK — {count} bar criteria verified, chain intact")
        sys.exit(0)
    print(f"FAIL: {err}", file=sys.stderr)
    sys.exit(2)


def cmd_list(args):
    path = bar_file(args.cycle)
    if not path.exists() or path.stat().st_size == 0:
        print("(no bar criteria registered yet)")
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        print(f"[{e['id']}] ({e['stage']}) {e['criterion']}")
        print(f"  measure: {e['measure']}")
        if "axis" in e:
            tag = " baseline-reset" if e.get("baseline_reset") else ""
            print(f"  axis:    {e['axis']} = {e['value']} ({e['direction']})  [#008 ratchet{tag}]")
        print()


def main():
    parser = argparse.ArgumentParser(
        description="Quality-bar pre-registration with hash chain (#006 bar-lock)"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_reg = sub.add_parser("register", help="Register a quality-bar criterion")
    p_reg.add_argument("--cycle", required=True)
    p_reg.add_argument("--id", required=True, help="Short bar ID, e.g., B1")
    p_reg.add_argument("--criterion", required=True)
    p_reg.add_argument("--stage", required=True, choices=STAGES)
    p_reg.add_argument("--measure", required=True)
    # #008 ratchet — 선택적 측정 가능 축(없으면 cross-cycle 비교 대상 아님)
    p_reg.add_argument("--axis", help="사이클을 넘어 안정적인 축 이름 (예: test-coverage)")
    p_reg.add_argument("--value", type=float, help="이 바의 수치 값 (ratchet 비교 대상)")
    p_reg.add_argument("--direction", choices=DIRECTIONS, help="higher_better | lower_better")
    p_reg.add_argument("--baseline-reset", action="store_true",
                       help="이 축 바로 이전 watermark 를 *대체*(accept-new-baseline, F3). "
                            "빼기 불가능한 정당 회귀용 — 축 메타 필수.")
    p_reg.set_defaults(func=cmd_register)

    p_ver = sub.add_parser("verify", help="Verify bar chain integrity")
    p_ver.add_argument("--cycle", required=True)
    p_ver.set_defaults(func=cmd_verify)

    p_list = sub.add_parser("list", help="List registered bar criteria")
    p_list.add_argument("--cycle", required=True)
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
