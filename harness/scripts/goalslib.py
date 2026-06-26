#!/usr/bin/env python3
"""
goalslib.py — gajae goal 상태(goals.json) read/write/validate 라이브러리 (P0).

goals.json 은 *가변* 실행 상태다(status/attempts 가 변한다) — hypotheses/bar/review 처럼
tamper-evident 체인이 아니다. 따라서 chainlog 와 무관하게 평범한 JSON 으로 다룬다.
스키마(spec §5)만 강제하고, 상태 전이 규칙(pending→running→passed|failed)을 코드로 둔다.

정책 vs 메커니즘: cap=3 판단은 *호출측*(Workflow) 이 한다. 라이브러리는 attempts 를
증가시키고 현재 값을 돌려줄 뿐 — "3회면 멈춰라" 는 오케스트레이션 책임.
"""
import json
import sys
from pathlib import Path

STATUSES = ("pending", "running", "passed", "failed")
MAX_ATTEMPTS = 3
_REQUIRED_GOAL_KEYS = ("id", "title", "acceptance_criteria", "skill_hints", "status", "attempts")


def goals_path(root: Path) -> Path:
    return Path(root) / "goals.json"


def load(root: Path) -> dict:
    p = goals_path(root)
    if not p.exists():
        raise FileNotFoundError(f"goals.json not found at {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def validate(data: dict) -> list:
    errs = []
    if not isinstance(data, dict):
        return ["root is not an object"]
    if not data.get("final_goal"):
        errs.append("missing final_goal")
    goals = data.get("goals")
    if not isinstance(goals, list) or not goals:
        errs.append("goals must be a non-empty list")
        return errs
    seen = set()
    for i, g in enumerate(goals):
        if not isinstance(g, dict):
            errs.append(f"goals[{i}] not an object")
            continue
        for k in _REQUIRED_GOAL_KEYS:
            if k not in g:
                errs.append(f"goals[{i}] missing '{k}'")
        gid = g.get("id")
        if gid in seen:
            errs.append(f"duplicate goal id '{gid}'")
        seen.add(gid)
        if g.get("status") not in STATUSES:
            errs.append(f"goals[{i}] invalid status '{g.get('status')}'")
        if not isinstance(g.get("acceptance_criteria"), list):
            errs.append(f"goals[{i}] acceptance_criteria not a list")
        if not isinstance(g.get("skill_hints"), list):
            errs.append(f"goals[{i}] skill_hints not a list")
        if not isinstance(g.get("attempts"), int):
            errs.append(f"goals[{i}] attempts not an int")
    return errs


def save(root: Path, data: dict) -> None:
    errs = validate(data)
    if errs:
        raise ValueError("goals.json validation failed: " + "; ".join(errs))
    goals_path(root).write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _find(data: dict, goal_id: str) -> dict:
    for g in data.get("goals", []):
        if g.get("id") == goal_id:
            return g
    raise ValueError(f"goal id '{goal_id}' not found")


def set_status(data: dict, goal_id: str, status: str) -> dict:
    if status not in STATUSES:
        raise ValueError(f"invalid status '{status}'")
    _find(data, goal_id)["status"] = status
    return data


def bump_attempt(data: dict, goal_id: str) -> int:
    g = _find(data, goal_id)
    g["attempts"] = int(g.get("attempts", 0)) + 1
    return g["attempts"]


def _selftest():
    import tempfile
    root = Path(tempfile.mkdtemp())
    data = {
        "final_goal": "ship X",
        "spec": ".claude/harness/specs/x.md",
        "goals": [
            {"id": "G001", "title": "t", "acceptance_criteria": ["a"],
             "skill_hints": ["develop:clean-code"], "status": "pending", "attempts": 0},
        ],
    }
    assert validate(data) == [], validate(data)
    save(root, data)
    loaded = load(root)
    assert loaded["goals"][0]["id"] == "G001"
    set_status(loaded, "G001", "running")
    assert loaded["goals"][0]["status"] == "running"
    assert bump_attempt(loaded, "G001") == 1
    assert bump_attempt(loaded, "G001") == 2
    # invalid status rejected
    try:
        set_status(loaded, "G001", "bogus"); assert False
    except ValueError:
        pass
    # missing id rejected
    try:
        set_status(loaded, "GX", "passed"); assert False
    except ValueError:
        pass
    # schema violation rejected on save
    bad = {"final_goal": "y", "goals": [{"id": "G1"}]}
    assert validate(bad), "expected schema errors"
    try:
        save(root, bad); assert False
    except ValueError:
        pass
    import shutil
    shutil.rmtree(root)
    print("goalslib OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    print("goalslib is a library; use --selftest or import it.", file=sys.stderr)
    sys.exit(1)
