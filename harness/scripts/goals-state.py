#!/usr/bin/env python3
"""
goals-state.py — goalslib 의 CLI 래퍼 (gajae P0). Workflow JS 가 Bash 로 호출.

상태 디렉토리 기본값 .claude/harness — 기존 cycles/active 와 *분리된* 네임스페이스.
goal-cycle 산출물은 .claude/harness/goal-cycles/<id>/ 아래 (cycles/<id> 와 혼동 금지).
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import goalslib  # noqa: E402

DEFAULT_ROOT = Path(".claude/harness")
_CYCLE_FILES = ["plan.md", "critic-review.md", "work-evidence.md",
                "verification.md", "rationale.md"]


def _root(args) -> Path:
    r = Path(args.root)
    r.mkdir(parents=True, exist_ok=True)
    return r


def cmd_init(args):
    root = _root(args)
    data = {"final_goal": args.final_goal, "spec": args.spec, "goals": []}
    goalslib.goals_path(root).write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"init goals.json at {goalslib.goals_path(root)}")


def cmd_add_goal(args):
    root = _root(args)
    data = goalslib.load(root)
    data["goals"].append({
        "id": args.id, "title": args.title,
        "acceptance_criteria": list(args.accept or []),
        "skill_hints": list(args.hint or []),
        "status": "pending", "attempts": 0,
    })
    goalslib.save(root, data)
    print(f"added {args.id}")


def cmd_set_status(args):
    root = _root(args)
    data = goalslib.load(root)
    goalslib.set_status(data, args.id, args.status)
    goalslib.save(root, data)
    print(args.status)


def cmd_bump_attempt(args):
    root = _root(args)
    data = goalslib.load(root)
    n = goalslib.bump_attempt(data, args.id)
    goalslib.save(root, data)
    print(n)


def cmd_scaffold_cycle(args):
    root = _root(args)
    cdir = root / "goal-cycles" / args.id
    cdir.mkdir(parents=True, exist_ok=True)
    for f in _CYCLE_FILES:
        fp = cdir / f
        if not fp.exists():
            fp.write_text(f"# {args.id} — {f}\n", encoding="utf-8")
    status = cdir / "status.json"
    if not status.exists():
        status.write_text(json.dumps(
            {"status": "pending", "attempts": 0, "blocker": None},
            indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"scaffolded {cdir}")


def cmd_show(args):
    root = _root(args)
    data = goalslib.load(root)
    print(f"final_goal: {data.get('final_goal')}")
    for g in data.get("goals", []):
        print(f"  [{g['id']}] {g['status']:8} attempts={g.get('attempts',0)}  {g['title']}")


def main():
    ap = argparse.ArgumentParser(description="gajae goal 상태 CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("init"); pi.add_argument("--root", default=str(DEFAULT_ROOT))
    pi.add_argument("--final-goal", required=True)
    pi.add_argument("--spec", default=""); pi.set_defaults(func=cmd_init)

    pa = sub.add_parser("add-goal"); pa.add_argument("--root", default=str(DEFAULT_ROOT))
    pa.add_argument("--id", required=True); pa.add_argument("--title", required=True)
    pa.add_argument("--accept", action="append"); pa.add_argument("--hint", action="append")
    pa.set_defaults(func=cmd_add_goal)

    ps = sub.add_parser("set-status"); ps.add_argument("--root", default=str(DEFAULT_ROOT))
    ps.add_argument("--id", required=True)
    ps.add_argument("--status", required=True, choices=goalslib.STATUSES)
    ps.set_defaults(func=cmd_set_status)

    pb = sub.add_parser("bump-attempt"); pb.add_argument("--root", default=str(DEFAULT_ROOT))
    pb.add_argument("--id", required=True)
    pb.set_defaults(func=cmd_bump_attempt)

    pc = sub.add_parser("scaffold-cycle"); pc.add_argument("--root", default=str(DEFAULT_ROOT))
    pc.add_argument("--id", required=True)
    pc.set_defaults(func=cmd_scaffold_cycle)

    psh = sub.add_parser("show"); psh.add_argument("--root", default=str(DEFAULT_ROOT))
    psh.set_defaults(func=cmd_show)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
