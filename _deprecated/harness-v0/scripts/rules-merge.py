#!/usr/bin/env python3
"""
rules-merge.py — L0+L1 rule-layering 머지 엔진 CLI (#010). `ruleslib` 위의 얇은 래퍼.

install이 만든 L1 user-rules를 L0와 *실제로 머지*해 "이 stage의 effective 룰"을 보여준다.
충돌은 declared layer로만 해소(§2), invariant는 보호, 같은-layer 중복은 차단.

Usage:
  rules-merge.py effective [--stage <s>] [--l1 PATH]   # 머지된 effective set (provenance 포함)
  rules-merge.py conflicts [--stage <s>] [--l1 PATH]   # 충돌 리포트 (차단성 충돌이면 exit 2)
  rules-merge.py layers   [--l1 PATH]                  # 어떤 layer 파일을 읽는지

기본 경로:
  L0 = <plugin>/06-rules.md  (ruleslib L0 파서와 동일 규약: parent.parent)
  L1 = $HARNESS_HOME/user-rules.md  (기본 ~/.harness — user-rules-init.py 와 동일)
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ruleslib  # noqa: E402

DEFAULT_L0 = Path(__file__).resolve().parent.parent / "06-rules.md"


def default_l1() -> Path:
    home = Path(os.environ.get("HARNESS_HOME", str(Path.home() / ".harness")))
    return home / "user-rules.md"


def _load(args):
    l1 = Path(args.l1) if args.l1 else default_l1()
    return ruleslib.load_layers(DEFAULT_L0, l1), l1


def cmd_layers(args):
    _, l1 = _load(args)
    print(f"L0: {DEFAULT_L0}  (존재: {DEFAULT_L0.exists()})")
    print(f"L1: {l1}  (존재: {l1.exists()})")


def cmd_effective(args):
    rules, _ = _load(args)
    effective, conflicts = ruleslib.merge(rules, stage=args.stage)
    if ruleslib.has_blocking_conflict(conflicts):
        print("🛑 차단성 충돌(같은 layer 같은 id) — 사람 개입 필요. `conflicts` 로 확인.",
              file=sys.stderr)
        sys.exit(2)
    # --dynamic: 정적 L0 default(매 세션 불변·overridable)는 빼고, *세션 관련* 슬라이스만 —
    # invariant L0(필수, 항상 적용) + L1/L2/L3(사용자/프로젝트/사이클). 토큰 경량화용
    # (rule-inject SessionStart 주입). 전량 카탈로그는 기본 effective / `--stage` 로 조회 유지.
    omitted = 0
    if args.dynamic:
        kept = [r for r in effective if r["layer"] != "L0" or r["scope"] == "invariant"]
        omitted = len(effective) - len(kept)
        effective = kept
    head = "# Effective rules" + (f" — stage: {args.stage}" if args.stage else " (all stages)")
    mode = " · dynamic(invariant+L1↑)" if args.dynamic else ""
    print(head)
    print(f"({len(effective)} effective{mode} · L1>L0 · invariant always-on)")
    for r in effective:
        inv = "!" if r["scope"] == "invariant" else ""   # ! = invariant(override 불가)
        print(f"## {r['id']} ({r['layer']}{inv}): {r['title']}")
    if args.dynamic and omitted:
        print(f"\n› 정적 L0 default {omitted}개 생략(매 세션 불변) — 전량은 06-rules.md, "
              f"단계별은 `rules-merge effective --stage <stage>` 로 조회(기능 유지).")


def cmd_conflicts(args):
    rules, _ = _load(args)
    _, conflicts = ruleslib.merge(rules, stage=args.stage)
    if not conflicts:
        print("충돌 없음 (effective = 우선순위 머지 결과 그대로).")
        return
    print(f"# 충돌 리포트 ({len(conflicts)})\n")
    for c in conflicts:
        t = c["type"]
        if t == "same_layer_dup":
            print(f"🛑 same_layer_dup: {c['id']} @ {c['layer']} — 같은 layer 중복, 자동선택 거부(AP-26). 사람이 promote/merge.")
        elif t == "invariant_protected":
            print(f"🛡  invariant_protected: {c['id']}@{c['protected_layer']} 는 override 불가 — {c['attempted_by']} 거부 (via {c['via']}).")
        elif t == "overridden":
            print(f"↦  overridden: {c['id']}@{c['loser_layer']} ← {c['winner']} (via {c['via']}).")
        elif t == "override_target_missing":
            print(f"⚠  override_target_missing: {c['id']} 가 없는 룰 '{c['target']}' override 시도.")
        elif t == "override_wrong_direction":
            print(f"⚠  override_wrong_direction: {c['id']} 가 같거나 높은 layer({c['target']}@{c['target_layer']}) override 시도 — 무시.")
    if ruleslib.has_blocking_conflict(conflicts):
        sys.exit(2)


def main():
    ap = argparse.ArgumentParser(description="L0+L1 rule-layering 머지 엔진")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("effective", "conflicts"):
        p = sub.add_parser(name)
        p.add_argument("--stage", help="이 stage 의 effective 룰만")
        p.add_argument("--l1", help="L1 user-rules 경로 (기본 $HARNESS_HOME/user-rules.md)")
        if name == "effective":
            p.add_argument("--dynamic", action="store_true",
                           help="SessionStart 주입 슬라이스: invariant L0 + L1/L2/L3 만(정적 L0 default 생략). "
                                "rule-inject(SessionStart) hook 이 이 뷰를 자동주입한다. 생략된 정적 L0 default"
                                "(R-CD 코딩 룰 등)는 stage-inject(PreToolUse) 가 단계 진입 시 재주입 → 기능 보존. "
                                "전량 카탈로그는 기본 effective / `--stage <s>` 로 조회.")
    pl = sub.add_parser("layers")
    pl.add_argument("--l1")
    args = ap.parse_args()
    {"effective": cmd_effective, "conflicts": cmd_conflicts, "layers": cmd_layers}[args.cmd](args)


if __name__ == "__main__":
    main()
