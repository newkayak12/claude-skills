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
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

CYCLES_DIR = Path("cycles")


def cycle_path(cycle_id: str) -> Path:
    return CYCLES_DIR / cycle_id


def hypotheses_file(cycle_id: str) -> Path:
    return cycle_path(cycle_id) / "hypotheses.jsonl"


def compute_hash(entry: dict, prev_hash: str) -> str:
    payload = json.dumps(
        {k: v for k, v in entry.items() if k != "hash"},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256((prev_hash + payload).encode("utf-8")).hexdigest()


def last_hash(path: Path) -> str:
    if not path.exists():
        return "0" * 64
    last = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            last = json.loads(line)
    return last["hash"] if last else "0" * 64


def cmd_register(args):
    cdir = cycle_path(args.cycle)
    if not cdir.exists():
        print(f"ERROR: cycle directory not found: {cdir}", file=sys.stderr)
        sys.exit(1)

    path = hypotheses_file(args.cycle)
    prev = last_hash(path)

    entry = {
        "id": args.id,
        "hypothesis": args.hypothesis,
        "kill_line": args.kill_line,
        "pass_line": args.pass_line,
        "registered_at": datetime.now(timezone.utc).isoformat(),
        "prev_hash": prev,
    }
    entry["hash"] = compute_hash(entry, prev)

    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

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

    prev = "0" * 64
    count = 0
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as e:
            print(f"FAIL line {i}: malformed JSON ({e})")
            sys.exit(2)

        if entry.get("prev_hash") != prev:
            print(f"FAIL line {i} [{entry.get('id')}]: prev_hash mismatch — chain broken")
            print(f"  expected prev: {prev[:16]}...")
            print(f"  found    prev: {entry.get('prev_hash', '?')[:16]}...")
            sys.exit(2)

        expected = compute_hash(entry, prev)
        if entry.get("hash") != expected:
            print(f"FAIL line {i} [{entry.get('id')}]: hash mismatch — TAMPERED")
            print(f"  expected: {expected[:16]}...")
            print(f"  found:    {entry.get('hash', '?')[:16]}...")
            sys.exit(2)

        prev = entry["hash"]
        count += 1

    print(f"OK — {count} hypotheses verified, chain intact")
    sys.exit(0)


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
