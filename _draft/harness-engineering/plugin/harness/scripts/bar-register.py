#!/usr/bin/env python3
"""
bar-register.py — Pre-registration of the *quality bar* with a tamper-evident hash chain.

사이클 시작 시 품질 기준(gate 임계 / DoD / stage별 필수 리뷰)을 bar.jsonl 에 등록한다.
가설(hypothesis-register.py)과 동일한 chainlog — 사후에 바를 *낮추면* verify 가 탐지.
이것이 "지친 에이전트가 중간에 바를 낮추는" 품질 저하 경로의 물리적 방지선 (#006).
#007(독립 리뷰)·#008(ratchet)이 각 항목의 stage·measure 를 소비한다.

Usage:
  bar-register.py register --cycle <id> --id <Bn> \\
      --criterion "..." --stage <plan|build|test|close|*> --measure "..."
  bar-register.py verify --cycle <id>
  bar-register.py list   --cycle <id>
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
    entry = chainlog.append_entry(
        bar_file(args.cycle),
        {
            "id": args.id,
            "criterion": args.criterion,
            "stage": args.stage,
            "measure": args.measure,
            "registered_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    print(f"REGISTERED bar [{args.id}] stage={args.stage} in cycle {args.cycle}")
    print(f"  criterion: {args.criterion}")
    print(f"  measure:   {args.measure}")
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
