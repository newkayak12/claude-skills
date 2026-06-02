#!/usr/bin/env python3
"""
review-register.py — Independent-review verdicts with a tamper-evident hash chain (#007 ②).

doer≠reviewer: fresh subagent 가 잠긴 품질 바(bar.jsonl)의 각 기준을 채점하고
그 결과를 review.jsonl 에 append 한다. close-cycle.py 게이트가 이 레코드를 소비한다.

bar_hash 는 사람이 손으로 적지 않는다 — criterion-id 로 bar.jsonl 에서 *현재 잠긴 해시*를
자동 해소해 결박한다. 바를 사후에 낮추면(새 엔트리) hash 가 달라져 게이트가 여전히 차단.

Usage:
  review-register.py register --cycle <id> --id <Rn> --criterion-id <Bn> \\
      --verdict pass|fail --evidence "..." --reviewer "<who>"
  review-register.py verify --cycle <id>
  review-register.py list   --cycle <id>
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chainlog  # noqa: E402

CYCLES_DIR = Path("cycles")
VERDICTS = ("pass", "fail")


def review_file(cycle_id: str) -> Path:
    return CYCLES_DIR / cycle_id / "review.jsonl"


def bar_file(cycle_id: str) -> Path:
    return CYCLES_DIR / cycle_id / "bar.jsonl"


def resolve_bar_hash(cycle_id: str, criterion_id: str) -> str:
    """criterion-id 로 잠긴 바 엔트리의 hash 를 해소. 없거나 중복이면 종료(exit 1)."""
    path = bar_file(cycle_id)
    if not path.exists():
        print(f"ERROR: bar.jsonl not found at {path} — 먼저 품질 바를 등록하세요.", file=sys.stderr)
        sys.exit(1)
    matches = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        if e.get("id") == criterion_id:
            matches.append(e)
    if not matches:
        print(f"ERROR: 품질 바에 criterion id '{criterion_id}' 없음. bar-register.py list 로 확인.",
              file=sys.stderr)
        sys.exit(1)
    if len(matches) > 1:
        print(f"ERROR: 품질 바에 criterion id '{criterion_id}' 중복 — 바 무결성 위반.", file=sys.stderr)
        sys.exit(1)
    return matches[0]["hash"]


def cmd_register(args):
    cdir = CYCLES_DIR / args.cycle
    if not cdir.exists():
        print(f"ERROR: cycle directory not found: {cdir}", file=sys.stderr)
        sys.exit(1)
    bar_hash = resolve_bar_hash(args.cycle, args.criterion_id)
    entry = chainlog.append_entry(review_file(args.cycle), {
        "id": args.id,
        "criterion_id": args.criterion_id,
        "bar_hash": bar_hash,
        "verdict": args.verdict,
        "evidence": args.evidence,
        "reviewer": args.reviewer,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    })
    print(f"REGISTERED review [{args.id}] {args.criterion_id} -> {args.verdict} (cycle {args.cycle})")
    print(f"  bar_hash: {bar_hash[:16]}...  (잠긴 바에 결박)")
    print(f"  evidence: {args.evidence}")
    print(f"  reviewer: {args.reviewer}")
    print(f"  hash: {entry['hash'][:16]}...")
    print()
    print("주의: 이 레코드를 *수정*하면 verify 에서 탐지됨. 재채점은 *새 ID*로.")


def cmd_verify(args):
    ok, count, err = chainlog.verify_chain(review_file(args.cycle))
    if ok:
        print(f"OK — {count} reviews verified, chain intact")
        sys.exit(0)
    print(f"FAIL: {err}", file=sys.stderr)
    sys.exit(2)


def cmd_list(args):
    path = review_file(args.cycle)
    if not path.exists() or path.stat().st_size == 0:
        print("(no reviews registered yet)")
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        print(f"[{e['id']}] {e['criterion_id']} -> {e['verdict']}  (bar {e['bar_hash'][:12]}…)")
        print(f"  evidence: {e['evidence']}")
        print(f"  reviewer: {e['reviewer']}")
        print()


def main():
    parser = argparse.ArgumentParser(
        description="Independent-review registration with hash chain (#007)"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("register", help="Register a review verdict")
    p.add_argument("--cycle", required=True)
    p.add_argument("--id", required=True, help="Short review ID, e.g., R1")
    p.add_argument("--criterion-id", required=True, help="Bar criterion being graded, e.g., B1")
    p.add_argument("--verdict", required=True, choices=VERDICTS)
    p.add_argument("--evidence", required=True, help="관측 근거 (bar 의 measure 에 대고)")
    p.add_argument("--reviewer", required=True, help="채점자 식별 (예: subagent:spec-reviewer)")
    p.set_defaults(func=cmd_register)

    pv = sub.add_parser("verify", help="Verify review chain integrity")
    pv.add_argument("--cycle", required=True)
    pv.set_defaults(func=cmd_verify)

    pl = sub.add_parser("list", help="List registered reviews")
    pl.add_argument("--cycle", required=True)
    pl.set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
