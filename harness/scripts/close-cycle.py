#!/usr/bin/env python3
"""
close-cycle.py — The ONLY sanctioned cycle-termination path (#007 quality-floor ②).

사이클을 닫으려면 잠긴 품질 바(bar.jsonl)의 *모든* 기준에 대해, 그 기준의 잠긴
해시를 참조하는 verdict=pass 리뷰(review.jsonl)가 존재해야 한다. 없으면 종료를 거부한다.
이것이 "지친 에이전트가 바를 충족하지 않고 사이클을 닫는" 품질 저하 경로의 물리적 차단선.

fresh subagent 채점(doer≠reviewer)은 *프로토콜*이며, 이 게이트는 그 산출물(리뷰 레코드)의
*존재 + 잠긴 바 결박 + pass + reviewer≠author(H3)*를 강제한다. metrics.json 의 author(doer)
와 동일한 reviewer 의 pass 리뷰는 게이트 충족으로 인정하지 않는다(self-review 차단). 종료는
in-process(파이썬)로 active symlink 를 unlink 하므로, Bash 를 가로채는 active-symlink-guard
hook 의 대상이 아니다 (정당 경로).

#008(ratchet): pass-review 체크를 통과해도, 이 cycle 이 *선언한 축*이 이전 닫힌 cycle 의
watermark 보다 회귀하면 종료를 거부한다(cross-cycle 단조 비감소). 축 미선언 cycle 은 무영향.

--force 는 게이트(리뷰/ratchet)를 무시하고 닫되 *흔적을 남긴다*: `--adr <존재하는 파일>` 결박
(없으면 거부) + blackbox.jsonl 에 `{kind:"force-close", adr, regressions, ...}` append.
게이트 우회 기록은 게이트만큼 중요하다(phase-advance --force 와 대칭, F2). 정당한 신규 baseline
상향은 force 가 아니라 bar-register --baseline-reset 으로(리뷰되는 1급 선언, F3).

Usage:
  close-cycle.py                       # cycles/active 를 닫는다 (게이트 통과 시)
  close-cycle.py --force --adr <path>  # 게이트 무시 강제 종료 (ADR 결박 + blackbox 기록)

Exit:
  0 = 닫힘
  2 = 게이트 차단 (리뷰 미충족 / 체인 깨짐 / 바 없음) — symlink 보존
  1 = 사용 오류 (active 없음 등)
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chainlog  # noqa: E402
import ratchetlib  # noqa: E402  (#008 cross-cycle ratchet)

CYCLES = Path("cycles")
ACTIVE = CYCLES / "active"


def resolve_active() -> str:
    if not ACTIVE.exists() and not ACTIVE.is_symlink():
        print("ERROR: active 사이클이 없습니다 (cycles/active 없음).", file=sys.stderr)
        sys.exit(1)
    name = os.readlink(ACTIVE) if ACTIVE.is_symlink() else ACTIVE.name
    return Path(name).name


def load_entries(path: Path):
    out = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                out.append(json.loads(line))
    return out


def verify_or_block(path: Path, label: str):
    ok, _count, err = chainlog.verify_chain(path)
    if not ok:
        print(f"🛑 CLOSE 차단 — {label} 체인 검증 실패: {err}", file=sys.stderr)
        sys.exit(2)


def _cycle_author(metrics_path: Path) -> str:
    """metrics.json 의 author(doer) 식별자를 normalize 해 반환. 없으면 ''.
    H3 doer≠reviewer 강제의 비교 기준 — cycle-init 이 --author/$USER 로 기록."""
    if not metrics_path.exists():
        return ""
    try:
        m = json.loads(metrics_path.read_text(encoding="utf-8"))
    except Exception:
        return ""
    return str(m.get("author") or "").strip()


def _append_blackbox(cdir: Path, entry: dict) -> None:
    """게이트 우회 흔적을 blackbox.jsonl 에 append.
    fail-CLOSED (M): 감사 기록에 실패하면 close 하지 말고 에러 종료. 감사를 못 남기면 우회 불허."""
    entry.setdefault("ts", datetime.now(timezone.utc).isoformat())
    try:
        with (cdir / "blackbox.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        print(
            f"🛑 CLOSE 차단 — force-close 감사 기록(blackbox append) 실패: {e}\n"
            f"   감사를 못 남기면 우회를 허용하지 않는다(fail-CLOSED). 경로/권한 확인 후 재시도.",
            file=sys.stderr,
        )
        sys.exit(2)


def main():
    parser = argparse.ArgumentParser(description="Close the active harness cycle (gated).")
    parser.add_argument("--force", action="store_true", help="게이트 무시 강제 종료 (--adr 결박 + blackbox 기록)")
    parser.add_argument("--adr", help="--force 시 *필수* — 우회 사유를 담은 존재하는 ADR/문서 경로")
    args = parser.parse_args()

    cid = resolve_active()
    cdir = CYCLES / cid
    bar_path = cdir / "bar.jsonl"
    review_path = cdir / "review.jsonl"
    hyp_path = cdir / "hypotheses.jsonl"
    blackbox_path = cdir / "blackbox.jsonl"
    metrics_path = cdir / "metrics.json"

    if args.force:
        # ADR 결박 — 우회를 사유 문서에 묶는다. 존재 + 비어있지않음(size>0) 검사.
        # 0바이트 빈 파일은 사유 미작성으로 간주해 거부 (cycle-init _require_adr 와 동형, M).
        adr_p = Path(args.adr) if args.adr else None
        if not args.adr or not adr_p.exists() or adr_p.stat().st_size == 0:
            print(
                f"🛑 CLOSE 차단 — --force 종료에는 --adr <존재+비어있지않은 파일> 이 필수다.\n"
                f"   우회 사유를 ADR/문서로 남기고 그 경로를 결박하세요: "
                f"close-cycle.py --force --adr docs/adr/00XX-....md\n"
                f"   (게이트 우회 기록은 게이트만큼 중요 — F2 · cycle-init --force 와 대칭)",
                file=sys.stderr,
            )
            sys.exit(2)
        # 무엇을 우회했는지 기록: ratchet 회귀를 record-only 로 산출(차단 아님).
        regs = ratchetlib.find_regressions(cid)
        _append_blackbox(cdir, {
            "kind": "force-close",
            "cycle": cid,
            "adr": args.adr,
            "regressions": regs,
            "note": "close-cycle 게이트(리뷰/ratchet)를 --force 로 우회",
        })
        print(f"[WARN] --force: 게이트 무시하고 '{cid}' 강제 종료. ADR={args.adr} · blackbox 기록됨.", file=sys.stderr)
    else:
        # 1) 체인 무결성 (있는 것만)
        if hyp_path.exists() and hyp_path.stat().st_size > 0:
            verify_or_block(hyp_path, "hypotheses")

        bar_entries = load_entries(bar_path)
        if not bar_entries:
            print(
                f"🛑 CLOSE 차단 — '{cid}' 에 품질 바(bar.jsonl)가 없습니다.\n"
                "  닫으려면 먼저 bar-register.py 로 기준을 잠그고 독립 리뷰로 충족하세요.\n"
                "  (탐색 사이클이라 바가 불필요하면 --force + ADR)",
                file=sys.stderr,
            )
            sys.exit(2)
        verify_or_block(bar_path, "bar")

        if review_path.exists() and review_path.stat().st_size > 0:
            verify_or_block(review_path, "review")

        # 2) 게이트: 모든 바 기준에 pass 리뷰(잠긴 hash 결박) 존재?
        #    H3 doer≠reviewer 강제: pass 리뷰는 *author(doer) 와 다른 reviewer* 의 것만 인정한다.
        #    author 와 동일 reviewer 의 self-review 는 게이트 충족으로 치지 않는다(자기 채점 회피).
        author = _cycle_author(metrics_path)
        reviews = load_entries(review_path)
        passing = {}       # criterion_id -> set(bar_hash) — author≠reviewer 인 pass 만
        self_only = {}     # criterion_id -> set(bar_hash) — pass 지만 reviewer==author 인 것만 있을 때 진단용
        for r in reviews:
            if r.get("verdict") != "pass":
                continue
            cid_k = r.get("criterion_id")
            bh = r.get("bar_hash")
            reviewer = str(r.get("reviewer") or "").strip()
            if author and reviewer == author:
                self_only.setdefault(cid_k, set()).add(bh)
            else:
                passing.setdefault(cid_k, set()).add(bh)

        missing = [b.get("id") for b in bar_entries
                   if b.get("hash") not in passing.get(b.get("id"), set())]
        if missing:
            # self-review 만으로 막힌 기준은 별도로 짚어 준다(원인이 "리뷰 없음"이 아니라 "자기 채점").
            self_blocked = [
                b.get("id") for b in bar_entries
                if b.get("id") in missing
                and b.get("hash") in self_only.get(b.get("id"), set())
            ]
            msg = (
                "🛑 CLOSE 차단 — 다음 품질 기준이 *잠긴 바에 결박된 pass 리뷰*를 갖지 못함:\n"
                + "".join(f"  - {m}\n" for m in missing)
                + "  독립 리뷰어(fresh subagent)가 review-register.py 로 각 기준을 채점해야 합니다.\n"
                "  (doer≠reviewer — 자기 채점 회피). 바를 낮추면 bar-hash 불일치로 여전히 차단됨.\n"
            )
            if self_blocked:
                msg += (
                    f"  ⚠ 다음 기준은 author('{author}') *본인의* pass 리뷰만 존재 — self-review 는 게이트 불인정:\n"
                    + "".join(f"      - {m}\n" for m in self_blocked)
                    + "      author 와 다른 reviewer 로 재채점하거나, 정당 사유면 --force --adr.\n"
                )
            print(msg, file=sys.stderr)
            sys.exit(2)

        # 2.5) ratchet (#008): 선언한 축이 이전 닫힌 cycle watermark 보다 회귀?
        #      축을 선언 안 한 cycle 은 regs=[] → 통과(오탐 0). doer≠reviewer 와 직교.
        regs = ratchetlib.find_regressions(cid)
        if regs:
            print(
                "🛑 CLOSE 차단 — cross-cycle 품질 ratchet 회귀 (#008):\n"
                + "".join(
                    f"  - axis '{r['axis']}': 현재 {r['current']} vs floor {r['floor']} "
                    f"({r['direction']}, ←{r['source']}) — {r['reason']}\n"
                    for r in regs
                )
                + "  같은 축을 *더 나은 값*으로 잠가 올리거나, 의도된 회귀면 --force + ADR.\n"
                "  (축 미선언 바는 ratchet 대상 아님 — 무관 영역 cycle 은 차단되지 않음)",
                file=sys.stderr,
            )
            sys.exit(2)

    # 2.6) ratchet opt-out 가시화 (#008 / H6): 측정축 0개로 닫히는 사이클은 cross-cycle
    #      품질 floor 를 흔적 없이 비껴가므로 blackbox 에 ratchet-opt-out 을 남긴다(축 강제 X).
    #      이미 있으면 멱등. 축이 하나라도 있으면 no-op. 아래 blackbox 의식이 이 흔적을 함께 노출.
    ratchetlib.record_opt_out_if_no_axes(cdir, cid)

    # 3) 통과(또는 force) — black box 의식 제시
    print(f"=== Closing cycle: {cid} ===")
    print()
    print("── Black box 대면 (어긴 것 기록) ──")
    bb = load_entries(blackbox_path)
    if bb:
        for e in bb:
            print(f"  • {json.dumps(e, ensure_ascii=False)}")
    else:
        print("  (blackbox 비어 있음 — override/skip 0건)")
    print()

    # 4) metrics status=closed
    if metrics_path.exists():
        try:
            metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
        except Exception:
            metrics = {}
        metrics["status"] = "closed"
        metrics["closed_at"] = datetime.now(timezone.utc).isoformat()
        metrics_path.write_text(
            json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    # 5) active symlink 해제 (in-process — Bash guard 대상 아님 = 정당 경로)
    if ACTIVE.is_symlink() or ACTIVE.exists():
        ACTIVE.unlink()

    print(f"✓ 사이클 '{cid}' 종료됨. cycles/active 해제.")
    print("다음: retro.md 작성 (살림/의심/버림), TODO.md 큐 갱신 (SD-07).")
    sys.exit(0)


if __name__ == "__main__":
    main()
