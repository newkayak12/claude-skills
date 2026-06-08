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


def _closed_at(cdir: Path) -> str:
    """metrics.closed_at — baseline_reset 가 watermark 를 *대체*하므로 시간순 정렬용."""
    try:
        return json.loads((cdir / "metrics.json").read_text(encoding="utf-8")).get("closed_at") or ""
    except Exception:
        return ""


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

    반환: {axis: {"value": float, "direction": str, "source": cycle_id, "baseline_reset": bool}}
    *pass 리뷰 결박* 된 축 바만 기여 — force-close 로 미달인 채 닫힌 바는 floor 를 올리지 못함.

    accept-new-baseline (F3): `baseline_reset=true` 로 선언된(그리고 pass 리뷰된) 축 바는
    이전 watermark 를 *대체*한다 — 빼기 불가능한데 정당하게 +1 해야 하는(예: mechanism-count)
    경우를 표현. 일반 바는 종전처럼 *개선* 시에만 floor 를 움직인다. reset 의 대체 의미상
    사이클을 closed_at 시간순으로 처리해 가장 최근의 의도된 baseline 이 권위를 갖게 한다.
    """
    floor = {}
    if not cycles_root.exists():
        return floor
    closed = [c for c in cycles_root.iterdir()
              if c.is_dir() and c.name != "active"
              and not (exclude and c.name == exclude) and _is_closed(c)]
    closed.sort(key=lambda c: (_closed_at(c), c.name))
    for cdir in closed:
        passed = _passed_hashes(cdir)
        # 사이클 단위 축 기여 reduce — reset 바가 있으면 그 값이 우선(파일 순서 무관).
        contrib = {}  # axis -> {value, direction, reset}
        for e in _axis_bars(cdir):
            if e.get("hash") not in passed:
                continue
            axis, val, direction = e["axis"], float(e["value"]), e["direction"]
            reset = bool(e.get("baseline_reset"))
            c = contrib.get(axis)
            if (c is None
                    or (reset and not c["reset"])
                    or (reset == c["reset"] and _strictly_better(direction, val, c["value"]))):
                contrib[axis] = {"value": val, "direction": direction, "reset": reset}
        for axis, c in contrib.items():
            cur = floor.get(axis)
            if cur is None or c["reset"] or _strictly_better(c["direction"], c["value"], cur["value"]):
                floor[axis] = {"value": c["value"], "direction": c["direction"],
                               "source": cdir.name, "baseline_reset": c["reset"]}
    return floor


def best_declared(cdir: Path):
    """현재 사이클이 *잠근* 축별 best 값 (리뷰 무관 — 타깃 자체를 본다).

    같은 축의 낮은 바 + 높은 바가 함께 잠겨도 best 로 평가(floor 계산과 대칭).
    축에 `baseline_reset` 바가 하나라도 있으면 그 축을 reset 으로 표시(find_regressions 가
    의도된 신규 baseline 을 회귀로 오판하지 않도록).
    반환: {axis: {"value": float, "direction": str, "baseline_reset"?: True}}
    """
    best = {}
    reset_axes = set()
    for e in _axis_bars(cdir):
        axis, val, direction = e["axis"], float(e["value"]), e["direction"]
        if e.get("baseline_reset"):
            reset_axes.add(axis)
        cur = best.get(axis)
        if cur is None or _strictly_better(direction, val, cur["value"]):
            best[axis] = {"value": val, "direction": direction}
    for axis in reset_axes:
        if axis in best:
            best[axis]["baseline_reset"] = True
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
        if d.get("baseline_reset"):
            continue  # 의도된 신규 baseline 선언(accept-new-baseline, F3) — 회귀 아님.
            # (명시 플래그 + immutable bar.jsonl + pass 리뷰 통과가 게이트 — force 불요)
        if base["direction"] != d["direction"]:
            regs.append({"axis": axis, "current": d["value"], "floor": base["value"],
                         "direction": d["direction"], "source": base["source"],
                         "reason": f"direction 뒤집기 ({base['direction']}→{d['direction']})"})
        elif not _not_worse(d["direction"], d["value"], base["value"]):
            regs.append({"axis": axis, "current": d["value"], "floor": base["value"],
                         "direction": d["direction"], "source": base["source"],
                         "reason": "watermark 회귀"})
    return regs
