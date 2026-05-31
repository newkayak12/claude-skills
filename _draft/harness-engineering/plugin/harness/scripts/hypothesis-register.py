#!/usr/bin/env python3
"""
hypothesis-register.py — Pre-registration of hypotheses with a tamper-evident hash chain.

각 가설은 등록 시점에 SHA-256으로 *이전 항목과 체인*된 해시를 가진다.
사후에 가설/기각 라인을 수정하면 verify 단계에서 탐지된다.

이것이 AP-06 Gate fudging의 *물리적* 방지선.

Usage:
  hypothesis-register.py register --cycle <id> --id <hyp-id> \\
      --hypothesis "..." --kill-line "..." --pass-line "..."
  hypothesis-register.py verify --cycle <id>
  hypothesis-register.py list   --cycle <id>
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chainlog

CYCLES_DIR = Path("cycles")


def cycle_path(cycle_id: str) -> Path:
    return CYCLES_DIR / cycle_id


def hypotheses_file(cycle_id: str) -> Path:
    return cycle_path(cycle_id) / "hypotheses.jsonl"


def cmd_register(args):
    cdir = cycle_path(args.cycle)
    if not cdir.exists():
        print(f"ERROR: cycle directory not found: {cdir}", file=sys.stderr)
        sys.exit(1)

    path = hypotheses_file(args.cycle)
    entry = chainlog.append_entry(path, {
        "id": args.id,
        "hypothesis": args.hypothesis,
        "kill_line": args.kill_line,
        "pass_line": args.pass_line,
        "registered_at": datetime.now(timezone.utc).isoformat(),
    })

    print(f"REGISTERED [{args.id}] in cycle {args.cycle}")
    print(f"  hypothesis: {args.hypothesis}")
    print(f"  kill: {args.kill_line}")
    print(f"  pass: {args.pass_line}")
    print(f"  hash: {entry['hash'][:16]}...")
    print()
    print("주의: 이 항목을 *수정*하면 verify에서 탐지됨.")
    print("      변경이 필요하면 *새 ID*로 재등록 + ADR 작성.")


def cmd_verify(args):
    path = hypotheses_file(args.cycle)
    if not path.exists():
        print(f"ERROR: hypotheses file not found at {path}", file=sys.stderr)
        sys.exit(1)

    ok, count, err = chainlog.verify_chain(path)
    if ok:
        print(f"OK — {count} hypotheses verified, chain intact")
        sys.exit(0)
    else:
        print(f"FAIL: {err}", file=sys.stderr)
        sys.exit(2)


def cmd_list(args):
    path = hypotheses_file(args.cycle)
    if not path.exists() or path.stat().st_size == 0:
        print("(no hypotheses registered yet)")
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        print(f"[{e['id']}] {e['hypothesis']}")
        print(f"  kill: {e['kill_line']}")
        print(f"  pass: {e['pass_line']}")
        print(f"  at:   {e['registered_at']}")
        print()


def main():
    parser = argparse.ArgumentParser(
        description="Hypothesis pre-registration with hash chain (AP-06 prevention)"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_reg = sub.add_parser("register", help="Register a new hypothesis")
    p_reg.add_argument("--cycle", required=True)
    p_reg.add_argument("--id", required=True, help="Short hypothesis ID, e.g., H1")
    p_reg.add_argument("--hypothesis", required=True)
    p_reg.add_argument("--kill-line", required=True)
    p_reg.add_argument("--pass-line", required=True)
    p_reg.set_defaults(func=cmd_register)

    p_ver = sub.add_parser("verify", help="Verify hash chain integrity")
    p_ver.add_argument("--cycle", required=True)
    p_ver.set_defaults(func=cmd_verify)

    p_list = sub.add_parser("list", help="List registered hypotheses")
    p_list.add_argument("--cycle", required=True)
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
