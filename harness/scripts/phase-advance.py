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

사용:
  phase-advance.py <target>            # 인접 전진
  phase-advance.py <target> --force    # 임의 전환(blackbox 기록)
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


def main():
    ap = argparse.ArgumentParser(description="active 사이클 current_phase 전진")
    ap.add_argument("target", nargs="?", help=f"목표 phase {PHASES}")
    ap.add_argument("--force", action="store_true", help="인접 규칙 무시(blackbox 기록)")
    ap.add_argument("--show", action="store_true", help="현재 phase 출력")
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

    metrics["current_phase"] = target
    mp.write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")

    if not adjacent and args.force:
        bb = cdir / "blackbox.jsonl"
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "kind": "phase-force",
            "from": cur,
            "to": target,
            "note": "비인접 phase 전환을 --force 로 강행",
        }
        try:
            with bb.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            pass
        print(f"⚠️  phase {cur} → {target} (FORCE — blackbox 기록됨).")
    else:
        print(f"✓ phase {cur} → {target}.")
    sys.exit(0)


if __name__ == "__main__":
    main()
