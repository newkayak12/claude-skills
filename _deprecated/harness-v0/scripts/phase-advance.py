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

import chainlog  # 같은 scripts/ 디렉토리 — phase.jsonl tamper-evident chain (H1)

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


def _nonempty_evidence(path: Path) -> bool:
    """evidence 파일이 *내용을 가진* 산출물인지 검증.

    파일 존재만으로는 부족하다 — 0바이트/공백 stub 하나로 게이트를 통과시키면
    "산출물을 채팅에만 남김" 과 동급의 허니시스템이 된다(빈 파일 = 빈 채팅).
    최소 기준은 "비어있지 않음" 이지 임의 길이 임계가 아니다: 한 줄 ADR 포인터 같은
    정당한 짧은 evidence 는 통과해야 한다. size>0 으로 큰 파일을 빠르게 통과시키고,
    공백만인 경우만 내용을 읽어 strip 후 비어있는지 확인한다.
    """
    try:
        if not path.is_file():
            return False
        if path.stat().st_size <= 0:
            return False
        # 공백/개행만으로 채운 stub 도 빈 산출물로 간주(strip 후 비어있으면 거부).
        return bool(path.read_text(encoding="utf-8", errors="ignore").strip())
    except OSError:
        return False


def _existing_evidence(paths: list[str]) -> list[str]:
    out = []
    for p in paths:
        if not p:
            continue
        path = Path(p)
        if _nonempty_evidence(path):
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
            "산출물 evidence 파일 없음/비어있음(0바이트·공백 stub). 채팅 표도 빈 파일도 "
            "산출물이 아니므로 `--evidence <path>` 로 내용 있는 실제 파일을 지정하세요."
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
    ap.add_argument(
        "--confirmation-note",
        default="",
        help="collaborative phase confirm 시 *필수*(H2). 사용자가 무엇에 합의했는지 한 줄 — "
             "tamper-evident chain 에 박혀 retro/review 가 위조 confirm 을 대면한다.",
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

    cur_gate = (metrics.get("phase_gates") or {}).get(cur) or {}
    cur_collaborative = cur_gate.get("type") == "collaborative"

    # H2: collaborative phase 의 사용자 confirm 은 *무엇에 합의했는지* 감사 기록을 강제한다.
    # 플래그만으로 confirm 을 주장하던 허니시스템을 닫는다(완전 방지는 불가 — 하지만 tamper-evident
    # chain 에 note 가 박혀 retro/review 가 위조 confirm 을 대면할 수 있다).
    if adjacent and cur_collaborative and args.confirm_user and not args.confirmation_note.strip():
        print(
            f"🛑 거부: collaborative phase '{cur}' 의 --confirm-user 에는 --confirmation-note 가 필수다(H2).\n"
            "   사용자가 무엇에 합의했는지 한 줄로 명시하세요 — chain 에 감사 기록으로 박힙니다.\n"
            "   예: --confirm-user --confirmation-note \"design-doc v2 §3 API 계약 사용자 승인\"",
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

    # H1: 전환을 tamper-evident chain 에 append. phase-guard 는 metrics 가 아니라 *이 체인*을
    # 권위 소스로 읽으므로, metrics.json 직접편집으로는 게이트를 우회할 수 없다.
    completed_gate = (metrics.get("phase_gates") or {}).get(cur) or {}
    chainlog.append_entry(cdir / "phase.jsonl", {
        "id": f"{cur}->{target}",
        "from": cur,
        "to": target,
        "completed_phase": cur,
        "evidence": list(completed_gate.get("evidence") or []),
        "user_confirmed": bool(completed_gate.get("user_confirmed")),
        "collaborative": cur_collaborative,
        "confirmation_note": args.confirmation_note.strip() or None,
        "gate_forced": bool(args.force),
        "ts": datetime.now(timezone.utc).isoformat(),
    })

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
