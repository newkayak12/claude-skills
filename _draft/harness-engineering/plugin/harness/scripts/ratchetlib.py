#!/usr/bin/env python3
"""
ratchetlib.py — Cross-cycle quality *ratchet* primitives (#008 quality-floor ③).

chainlog.py 가 *한 사이클 안*의 변조를 막듯, ratchetlib 는 *사이클을 넘어* 바가
낮아지는 것을 막는다. 비교 가능한 것은 *측정 가능한 축(axis)*뿐 — 자유텍스트 바는 대상 아님.

축 = 사이클을 넘어 안정적인 이름 + 숫자 value + direction(higher_better|lower_better).
watermark = 이전 *닫힌* 사이클들 중 그 축에서 *pass 리뷰를 받은* 바 값의 best.
회귀 = 현재 사이클이 선언한 축의 best 값이 watermark 보다 나쁨(또는 방향 뒤집기).

close-cycle.py(게이트)와 ratchet-check.py(CLI)가 이 모듈을 공유 — 로직 drift 방지(DRY).
하이픈 없는 파일명 = chainlog.py 와 동일하게 import 가능(공유 lib 규약).
"""
import json
from pathlib import Path

CYCLES = Path("cycles")
DIRECTIONS = ("higher_better", "lower_better")


def _load_jsonl(path: Path):
    out = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                out.append(json.loads(line))
    return out


def _is_closed(cdir: Path) -> bool:
    m = cdir / "metrics.json"
    if not m.exists():
        return False
    try:
        return json.loads(m.read_text(encoding="utf-8")).get("status") == "closed"
    except Exception:
        return False


def _axis_bars(cdir: Path):
    """bar.jsonl 에서 *축을 선언한* 엔트리만 (axis/value/direction 모두 존재)."""
    out = []
    for e in _load_jsonl(cdir / "bar.jsonl"):
        if "axis" in e and "value" in e and "direction" in e:
            out.append(e)
    return out


def _passed_hashes(cdir: Path):
    """verdict=pass 리뷰가 결박한 bar_hash 집합."""
    return {r.get("bar_hash") for r in _load_jsonl(cdir / "review.jsonl")
            if r.get("verdict") == "pass"}


def _strictly_better(direction: str, a: float, b: float) -> bool:
    return a > b if direction == "higher_better" else a < b


def _not_worse(direction: str, a: float, b: float) -> bool:
    """a(current)가 b(floor)보다 나쁘지 않은가 — 동률 허용(단조 비감소)."""
    return a >= b if direction == "higher_better" else a <= b


def compute_floor(cycles_root: Path = CYCLES, exclude=None):
    """이전 *닫힌* 사이클들의 축별 watermark.

    반환: {axis: {"value": float, "direction": str, "source": cycle_id}}
    *pass 리뷰 결박* 된 축 바만 기여 — force-close 로 미달인 채 닫힌 바는 floor 를 올리지 못함.
    """
    floor = {}
    if not cycles_root.exists():
        return floor
    for cdir in sorted(cycles_root.iterdir()):
        if not cdir.is_dir() or cdir.name == "active":
            continue
        if exclude and cdir.name == exclude:
            continue
        if not _is_closed(cdir):
            continue
        passed = _passed_hashes(cdir)
        for e in _axis_bars(cdir):
            if e.get("hash") not in passed:
                continue
            axis, val, direction = e["axis"], float(e["value"]), e["direction"]
            cur = floor.get(axis)
            if cur is None or _strictly_better(direction, val, cur["value"]):
                floor[axis] = {"value": val, "direction": direction, "source": cdir.name}
    return floor


def best_declared(cdir: Path):
    """현재 사이클이 *잠근* 축별 best 값 (리뷰 무관 — 타깃 자체를 본다).

    같은 축의 낮은 바 + 높은 바가 함께 잠겨도 best 로 평가(floor 계산과 대칭).
    반환: {axis: {"value": float, "direction": str}}
    """
    best = {}
    for e in _axis_bars(cdir):
        axis, val, direction = e["axis"], float(e["value"]), e["direction"]
        cur = best.get(axis)
        if cur is None or _strictly_better(direction, val, cur["value"]):
            best[axis] = {"value": val, "direction": direction}
    return best


def find_regressions(cycle_id: str, cycles_root: Path = CYCLES):
    """현재 사이클의 선언 축이 이전 watermark 를 회귀하는지.

    반환: 회귀 dict 리스트(빈=정상). 각 dict: axis/current/floor/direction/source/reason.
    """
    floor = compute_floor(cycles_root, exclude=cycle_id)
    regs = []
    for axis, d in best_declared(cycles_root / cycle_id).items():
        base = floor.get(axis)
        if base is None:
            continue  # 이전에 없던 축 — 새 floor 설정(회귀 아님)
        if base["direction"] != d["direction"]:
            regs.append({"axis": axis, "current": d["value"], "floor": base["value"],
                         "direction": d["direction"], "source": base["source"],
                         "reason": f"direction 뒤집기 ({base['direction']}→{d['direction']})"})
        elif not _not_worse(d["direction"], d["value"], base["value"]):
            regs.append({"axis": axis, "current": d["value"], "floor": base["value"],
                         "direction": d["direction"], "source": base["source"],
                         "reason": "watermark 회귀"})
    return regs
