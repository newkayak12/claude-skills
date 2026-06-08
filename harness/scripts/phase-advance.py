#!/usr/bin/env python3
"""
phase-advance.py — active 사이클의 current_phase 전진 (유일 정당 경로).

Phase: analysis → design → planning → implementation → validation.
인접 전진만 허용. 스킵·역행은 거부(설계 단계 건너뛰기 = R-PG01 위반 위험).
`--force` 는 임의 전환을 허용하되 blackbox.jsonl 에 기록(책임추적 탈출구, #012 북성 교훈).

이것이 phase-guard.py 게이트의 *신뢰 전제*다 — current_phase 가 임의로 점프하지 않아야
"design 일 때 코드 차단" 이 의미를 갖는다 (#013b H3).

정직한 한계:
  metrics.json 의 current_phase 직접편집은 이 스크립트를 우회한다(metrics.json 은
  session-counter 가 갱신해야 해서 hypothesis-immutability 보호 대상이 아님). 즉 *정당
  경로를 코드로 만들되* 우회를 강제로 막진 못한다. 우회의 책임추적(blackbox)은 후속 사이클.

전진 게이트:
  새 cycle-init.py 가 만든 metrics.json 에 `phase_gates` 가 있으면, 현재 phase 를 떠나기 전에
  산출물 evidence 파일이 1개 이상 존재해야 한다. design/planning 같은 collaborative phase 는
  사용자 확인도 필요하다(`--confirm-user`). 이것이 "산출물을 채팅에만 남김"과
  "collaborative 문서를 AI 혼자 final 처리"를 막는 최소 물리 게이트다.

사용:
  phase-advance.py <target> --evidence docs/analysis.md
  phase-advance.py implementation --evidence docs/design.md --confirm-user
  phase-advance.py <target> --force    # 임의 전환/게이트 우회(blackbox 기록)
  phase-advance.py --show              # 현재 phase 출력
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

CYCLES = Path("cycles")
ACTIVE = CYCLES / "active"
PHASES = ["analysis", "design", "planning", "implementation", "validation"]


def _active_dir():
    if not ACTIVE.exists():
        return None
    cid = Path(ACTIVE.readlink() if ACTIVE.is_symlink() else ACTIVE.name).name
    return CYCLES / cid


def _append_blackbox(cdir: Path, entry: dict) -> None:
    entry.setdefault("ts", datetime.now(timezone.utc).isoformat())
    bb = cdir / "blackbox.jsonl"
    try:
        with bb.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _existing_evidence(paths: list[str]) -> list[str]:
    out = []
    for p in paths:
        if not p:
            continue
        path = Path(p)
        if path.exists():
            out.append(p)
    return out


def _merge_evidence(gate: dict, evidence: list[str]) -> None:
    existing = list(gate.get("evidence") or [])
    for ev in evidence:
        if ev not in existing:
            existing.append(ev)
    gate["evidence"] = existing


def _verify_phase_gate(cdir: Path, metrics: dict, phase: str, evidence: list[str],
                       confirm_user: bool, force: bool) -> bool:
    gates = metrics.get("phase_gates")
    if not isinstance(gates, dict) or phase not in gates:
        return True  # 오래된 cycle fixture 호환: 게이트 메타가 없으면 기존 동작 유지

    gate = gates.get(phase) or {}
    _merge_evidence(gate, evidence)
    if confirm_user:
        gate["user_confirmed"] = True
    gates[phase] = gate
    metrics["phase_gates"] = gates

    evidence_ok = bool(_existing_evidence(gate.get("evidence") or []))
    confirm_ok = gate.get("type") != "collaborative" or bool(gate.get("user_confirmed"))
    if evidence_ok and confirm_ok:
        return True

    if force:
        _append_blackbox(cdir, {
            "kind": "phase-gate-force",
            "phase": phase,
            "missing_evidence": not evidence_ok,
            "missing_user_confirm": not confirm_ok,
            "note": "phase 산출물/사용자확인 게이트를 --force 로 우회",
        })
        return True

    problems = []
    if not evidence_ok:
        problems.append(
            "산출물 evidence 파일 없음. 채팅 표는 산출물이 아니므로 "
            "`--evidence <path>` 로 실제 파일을 지정하세요."
        )
    if not confirm_ok:
        problems.append(
            "collaborative phase 사용자 확인 없음. draft→review→finalize 합의 후 "
            "`--confirm-user` 를 붙이세요."
        )
    print(
        f"🛑 거부: phase '{phase}' 완료 게이트 미충족.\n"
        + "".join(f"  - {p}\n" for p in problems)
        + "   예: python3 <plugin>/scripts/phase-advance.py <next> "
        "--evidence docs/design.md --confirm-user\n"
        "   정말 우회해야 하면 --force (blackbox 기록).",
        file=sys.stderr,
    )
    return False


def main():
    ap = argparse.ArgumentParser(description="active 사이클 current_phase 전진")
    ap.add_argument("target", nargs="?", help=f"목표 phase {PHASES}")
    ap.add_argument("--force", action="store_true", help="인접 규칙 무시(blackbox 기록)")
    ap.add_argument("--show", action="store_true", help="현재 phase 출력")
    ap.add_argument(
        "--evidence",
        action="append",
        default=[],
        help="현재 phase 완료 산출물 파일 경로 (반복 가능). 존재해야 전진 가능.",
    )
    ap.add_argument(
        "--confirm-user",
        action="store_true",
        help="collaborative phase(draft→review→finalize)에 대해 사용자 확인 완료 표시",
    )
    args = ap.parse_args()

    cdir = _active_dir()
    if cdir is None:
        print("active 사이클 없음.", file=sys.stderr)
        sys.exit(1)
    mp = cdir / "metrics.json"
    if not mp.exists():
        print("metrics.json 없음.", file=sys.stderr)
        sys.exit(1)
    try:
        metrics = json.loads(mp.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"metrics.json 파싱 실패: {e}", file=sys.stderr)
        sys.exit(1)

    cur = metrics.get("current_phase", "analysis")
    if args.show or not args.target:
        print(cur)
        sys.exit(0)

    target = args.target.strip().lower()
    if target not in PHASES:
        print(f"알 수 없는 phase '{target}'. 허용: {PHASES}", file=sys.stderr)
        sys.exit(2)

    cur_i = PHASES.index(cur) if cur in PHASES else 0
    tgt_i = PHASES.index(target)
    adjacent = (tgt_i == cur_i + 1)

    if not adjacent and not args.force:
        if tgt_i < cur_i:
            reason = "역행"
        elif tgt_i == cur_i:
            reason = "동일 단계"
        else:
            reason = f"스킵({tgt_i - cur_i}단계 건너뜀)"
        print(
            f"🛑 거부: '{cur}' → '{target}' 은 인접 전진이 아님 ({reason}).\n"
            f"   순서: {' → '.join(PHASES)}\n"
            f"   인접 전진만 허용. 정말 필요하면 --force (blackbox 기록).",
            file=sys.stderr,
        )
        sys.exit(2)

    if adjacent:
        if not _verify_phase_gate(cdir, metrics, cur, args.evidence, args.confirm_user, args.force):
            sys.exit(2)

    metrics["current_phase"] = target
    status = metrics.get("phase_status")
    if isinstance(status, dict):
        status[cur] = "done"
        status[target] = "in-progress"
        metrics["phase_status"] = status
    mp.write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")

    if not adjacent and args.force:
        _append_blackbox(cdir, {
            "kind": "phase-force",
            "from": cur,
            "to": target,
            "note": "비인접 phase 전환을 --force 로 강행",
        })
        print(f"⚠️  phase {cur} → {target} (FORCE — blackbox 기록됨).")
    else:
        print(f"✓ phase {cur} → {target}.")
    sys.exit(0)


if __name__ == "__main__":
    main()
