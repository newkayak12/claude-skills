#!/usr/bin/env python3
"""
ruleslib.py — Rule-layering 로딩/머지 엔진 (importable 순수함수, `chainlog`/`ratchetlib` 규약).

#010: install이 만든 L1 user-rules(`~/.harness/user-rules.md`)를 *실제 적용*한다.
L0(06-rules.md 카탈로그)과 L1(per-rule)을 각각의 파서로 읽어 통합 모델로 만들고,
stage별로 우선순위(L1 > L0 Default) 머지 + 각 effective rule에 provenance(layer)를 붙인다.

MVE 경계(사용자 결정): **L0 + L1만**. L2/L3는 후속 사이클.
포맷 SSOT(사용자 결정): L1/L2/L3는 per-rule 포맷 1개(`user-rules-init` 스타일),
L0(45룰 카탈로그)는 그대로 두고 엔진이 *두 파서*로 읽어 통합 모델로 머지.

충돌 해소 = **declared layer로만**(§2, 해석 금지):
  - 같은 id가 여러 layer → 높은 layer 승(낮은 것 suppress). 단 낮은 것이 *invariant*면 보호(승자 거부).
  - 명시 `Overrides: <id>` → 그 target을 suppress. target이 invariant면 보호(override 거부).
  - 같은 layer 같은 id → 자동선택 안 함, **에러**(AP-26 차단).
  - override target 부재 / 방향 오류(같거나 높은 layer override) → 충돌 리포트에 남김(silent 금지).

invariant 판정(MVE 근사): L0 섹션 헤더에 `(필수)` 마커가 있으면 그 섹션 룰은 invariant.
  *선언된* 마커 기반 — 추론 아님. 정밀 per-rule 태깅은 backlog(§4의 5개 Core 후보).
"""
import re
from pathlib import Path

# 높을수록 우선. L0.5(situational)는 MVE 미사용이나 순서엔 둠.
LAYER_ORDER = {"L0": 0, "L0.5": 1, "L1": 2, "L2": 3, "L3": 4}
WILDCARD_STAGES = {"always", "*"}

# --- L0 (06-rules.md 카탈로그) 파서: H2 섹션 + 로딩시점 + H3 룰 ---
_L0_SECTION = re.compile(r"^##\s+(\S.*)$")                 # H2 섹션 헤더
_L0_LOAD = re.compile(r"^\s*\*\*Loading point\*\*\s*:\s*(.+)$")  # section stage
_L0_RULE = re.compile(r"^###\s+([A-Za-z][\w-]*):\s*(.+)$")  # H3 룰
_BACKTICK = re.compile(r"`([^`]+)`")

# --- L1/L2/L3 (per-rule) 파서: '## R-XX: title' + key:value 줄 ---
_PR_RULE = re.compile(r"^##\s+([A-Za-z][\w-]*):\s*(.+)$")
_PR_KEY = re.compile(r"^([A-Za-z][\w-]*)\s*:\s*(.*)$")


def _stages_from(text: str) -> set:
    return {t.strip().lower() for t in _BACKTICK.findall(text)} or \
           {t.strip().lower() for t in re.split(r"[,\s]+", text) if t.strip()}


def parse_l0(text: str, source: str = "L0") -> list:
    """섹션 단위 로딩시점·`(필수)` scope를 H3 룰에 상속."""
    rules, current = [], None
    sec_stages, sec_scope = set(), "default"
    for line in text.splitlines():
        rm = _L0_RULE.match(line)
        if rm:
            if current:
                rules.append(current)
            current = {
                "id": rm.group(1), "title": rm.group(2).strip(),
                "layer": "L0", "scope": sec_scope, "stages": set(sec_stages),
                "overrides": None, "source": source, "body": [line],
            }
            continue
        sm = _L0_SECTION.match(line)
        if sm:
            if current:
                rules.append(current)
                current = None
            sec_stages = set()
            # '(mandatory)' marker = invariant (declared, not inferred)
            sec_scope = "invariant" if "(mandatory)" in sm.group(1) else "default"
            continue
        lm = _L0_LOAD.match(line)
        if lm:
            sec_stages = {t.strip().lower() for t in _BACKTICK.findall(lm.group(1))}
            continue
        if current is not None:
            current["body"].append(line)
    if current:
        rules.append(current)
    return rules


def parse_l1(text: str, layer: str = "L1", source: str = "L1") -> list:
    """per-rule 포맷: '## id: title' 다음 Layer/Scope/Stage/Pointer/Why/Overrides 줄."""
    rules, current = [], None
    for raw in text.splitlines():
        rm = _PR_RULE.match(raw)
        if rm:
            if current:
                rules.append(current)
            current = {
                "id": rm.group(1), "title": rm.group(2).strip(),
                "layer": layer, "scope": "default", "stages": set(),
                "overrides": None, "source": source, "body": [raw], "_pointer": None,
            }
            continue
        if current is None:
            continue
        current["body"].append(raw)
        km = _PR_KEY.match(raw)
        if not km:
            continue
        key, val = km.group(1).lower(), km.group(2).strip()
        if key == "layer" and val:
            current["layer"] = val
        elif key == "scope" and val:
            current["scope"] = val.lower()
        elif key == "stage" and val:
            current["stages"] = {t.strip().lower() for t in re.split(r"[,\s]+", val) if t.strip()}
        elif key == "overrides" and val:
            current["overrides"] = val.split()[0]
        elif key == "pointer" and val:
            current["_pointer"] = val
    if current:
        rules.append(current)
    return rules


def load_layers(l0_path=None, l1_path=None) -> list:
    """존재하는 layer 파일만 읽어 통합 룰 리스트."""
    rules = []
    if l0_path and Path(l0_path).exists():
        rules += parse_l0(Path(l0_path).read_text(encoding="utf-8"),
                          source=str(l0_path))
    if l1_path and Path(l1_path).exists():
        rules += parse_l1(Path(l1_path).read_text(encoding="utf-8"),
                          layer="L1", source=str(l1_path))
    return rules


def _stage_match(rule: dict, stage) -> bool:
    if stage is None:
        return True
    s = stage.lower()
    return s in rule["stages"] or bool(rule["stages"] & WILDCARD_STAGES)


def _rank(rule: dict) -> int:
    return LAYER_ORDER.get(rule["layer"], 0)


def merge(rules: list, stage=None):
    """통합 룰을 머지 → (effective, conflicts). suppress는 dict에 플래그로 표기."""
    conflicts = []
    for r in rules:
        r.setdefault("suppressed", False)
        r["suppressed"] = False
        r["suppressed_by"] = None

    # 1) 같은 layer 같은 id → 에러(자동선택 금지, AP-26)
    seen = {}
    for r in rules:
        k = (r["layer"], r["id"])
        if k in seen:
            conflicts.append({"type": "same_layer_dup", "id": r["id"], "layer": r["layer"]})
        seen[k] = r

    by_id = {}
    for r in rules:
        by_id.setdefault(r["id"], []).append(r)

    def _suppress(loser, winner, kind):
        # invariant 보호: 낮은 invariant는 못 덮는다 → winner(공격자) 거부
        if loser["scope"] == "invariant":
            winner["suppressed"] = True
            winner["suppressed_by"] = f"invariant-protected:{loser['id']}@{loser['layer']}"
            conflicts.append({"type": "invariant_protected", "id": loser["id"],
                              "protected_layer": loser["layer"],
                              "attempted_by": f"{winner['id']}@{winner['layer']}", "via": kind})
        else:
            loser["suppressed"] = True
            loser["suppressed_by"] = f"{winner['id']}@{winner['layer']}({kind})"
            conflicts.append({"type": "overridden", "id": loser["id"],
                              "loser_layer": loser["layer"],
                              "winner": f"{winner['id']}@{winner['layer']}", "via": kind})

    # 2) 같은 id 여러 layer → 높은 layer 승
    for rid, group in by_id.items():
        if len(group) < 2:
            continue
        top = max(group, key=_rank)
        for r in group:
            if r is top:
                continue
            if _rank(r) < _rank(top):
                _suppress(r, top, "same-id")

    # 3) 명시 Overrides
    for w in rules:
        if w["suppressed"] or not w["overrides"]:
            continue
        targets = by_id.get(w["overrides"])
        if not targets:
            conflicts.append({"type": "override_target_missing",
                              "id": w["id"], "target": w["overrides"]})
            continue
        for t in targets:
            if t is w:
                continue
            if _rank(t) < _rank(w):
                _suppress(t, w, "overrides")
            else:
                conflicts.append({"type": "override_wrong_direction", "id": w["id"],
                                  "target": t["id"], "target_layer": t["layer"]})

    effective = [r for r in rules if not r["suppressed"] and _stage_match(r, stage)]
    effective.sort(key=lambda r: (-_rank(r), r["id"]))
    return effective, conflicts


def has_blocking_conflict(conflicts: list) -> bool:
    """같은-layer 중복은 *해소 불가*(사람 개입 필요) — 차단성."""
    return any(c["type"] == "same_layer_dup" for c in conflicts)
