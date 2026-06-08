#!/usr/bin/env python3
"""
cycle-init.py — Scaffold a new harness cycle.

WIP=1 (SD-03) 자동 확인 — 이미 active 사이클이 있으면 거부.

Usage:
  cycle-init.py <name>
  cycle-init.py <name> --force   # 기존 active 사이클 무시 (위험 — ADR 권장)
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

CYCLES_DIR = Path("cycles")
ACTIVE_LINK = CYCLES_DIR / "active"


CYCLE_CARD = """# Cycle Card — {name}

| Field | Value |
|---|---|
| Cycle ID | {cid} |
| Start | {start} |
| Cycle type | {ctype}  (Product / Dev-tool / Exploration — see [09 §9.1b](../../09-pre-cycle.md#91b-사이클-타입--게이트는-타입에-따라-적응한다)) |
| Time budget | ___ (Product: weeks / Dev-tool·Exploration: sessions·appetite) |
| Cost budget | ___ |
| Status | Active |

## 핵심 가설 (≤3)

- H1: ___
- H2: ___
- H3: ___

> 가설 *공식 등록*은 `scripts/hypothesis-register.py register` — tamper-evident.
> 위 H1~H3는 *사람이 보는* 요약일 뿐, 실제 통과/기각 라인은 hypotheses.jsonl이 SSOT.

## Persona 가설

- ___

## 성공 기준 (수치)

- Gate 1: ___ → [08 §8.2](../../08-pass-criteria.md#82-gate-1--제품-가설-검증-기준)
- Gate 2: ___ → [08 §8.3](../../08-pass-criteria.md#83-gate-2--기술-가설-검증-기준)

## Kill 기준

- **Hard**: 재진입 3회 / 세션 > appetite_sessions × 2 (박스를 두 배 넘김)
- **Soft**: 세션 > appetite_sessions (박스 초과) → 재평가 트리거
- 시간=*작업 세션* 단위 (wall-clock 아님 — 방치 오탐 방지, cycle-004). 예산$은 관측 불가로 kill 제외.
- (사이클별 조정 시 ADR 필요)
- **Exploration 타입 defer 허용**: 학습형 사이클은 Kill 기준이 사이클 중 구체화되는 경우가 많다.
  초기엔 위 세션 기반 Hard/Soft만 두고, 도메인 Kill은 `TBD (사이클 중 확정)`로 남길 수 있다.
  단 **종료 게이트 전까지는 반드시 확정** — TBD인 채로 close 불가.

## Phase 진행 (현재 단계 추적 — SSOT는 metrics.json `current_phase`)

> 사이클 내 작업은 단계로 진행된다. AI는 *행동 전에 현재 phase를 확인*하고, 단계를 건너뛰거나 섞지 않는다.
> 산출물은 *채팅이 아니라 아래 저장 위치의 파일*로 남긴다 — 채팅은 휘발성(다음 세션 유실).
> collaborative 산출물은 **사용자 확인 게이트** 통과 전엔 다음 phase로 못 넘어간다 (R-PG01 "No code before design").

| Phase | 산출물 (저장 위치) | 유형 | 상태 |
|---|---|---|---|
| Analysis | 분석 노트 → `docs/**` 또는 `./findings.md` | solo | ☐ todo |
| Design | Design Doc·ADR → `docs/**` | **collaborative** (draft→review→finalize) | ☐ todo |
| Planning | 로드맵·플랜 → `docs/**` | **collaborative** | ☐ todo |
| Implementation | 코드·테스트 → repo | solo | ☐ todo |
| Validation | 독립 리뷰 → `./review.jsonl`, 회고 → `./retro.md` | solo + 독립리뷰 | ☐ todo |

> 상태 표기: `☐ todo` → `▶ in-progress` → `✅ done`. Phase 완료 시 "산출물이 지정 위치 파일로 존재하는가" 검증 후 다음으로.

## 이전 사이클 인계 (살림 / 의심 / 버림)

- 살림: ___
- 의심: ___
- 버림: ___

## Pivot triggers (사전 정의)

- 신호 A → Pivot 타입 X
- 신호 B → Pivot 타입 Y

## 관련 문서

- Pre-mortem: ./pre-mortem.md
- Gate criteria: ./gate-criteria.md
- Hypotheses: ./hypotheses.jsonl
- Retro: ./retro.md
- Activity log: ./activity.log
- Black box (어긴 것 기록): ./blackbox.jsonl  → [13 §4](../../13-operational-layer.md#4-black-box--막지-말고-기록)
- Quality bar (잠금): ./bar.jsonl  → bar-register.py 로 등록 (#006)
- Reviews (독립 채점): ./review.jsonl  → review-register.py 로 등록 (#007)
- Dogfood findings: ./findings.md
"""


FINDINGS = """# Dogfood Findings — {name}

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | ___ | ___ | low/medium/high | ___ |

## 살아있는 로그
이후 단계에서 발견되는 것을 여기에 append.
"""


PRE_MORTEM = """# Pre-mortem — {name}

> "6개월 뒤 이 사이클이 *실패*했다고 가정. 왜 실패했는가?"
> 참조: [C-02 Pre-mortem](../../situational-rules/cognitive.md#c-02-pre-mortem-before-big-bet)

## 실패 시나리오 (≥5)

1. ___
2. ___
3. ___
4. ___
5. ___

## 가장 가능성 높은 1-2개

- ___ (가능성: ___)
- ___ (가능성: ___)

## 사전 완화책

- ___
- ___
"""


GATE_CRITERIA = """# Gate Criteria — {name}

> 사이클 *시작 전* 고정. 변경 시 ADR + 사유.
> Reference: [08-pass-criteria.md](../../08-pass-criteria.md)

## Gate 1 — 제품 가설 검증

### 정량

- 인터뷰 N: ≥ ___
- 가설 일치율: ≥ ___%
- 행동 약속 (지불/시간/전환): ≥ ___명
- Persona 외 발화: < ___%

### 정성

- [ ] Mom Test 위반 0
- [ ] 기각 라인 사전 정의 (hypotheses.jsonl에 등록)

## Gate 2 — 기술 가설 검증

### 정량

- P95 latency: < ___ms
- Error rate: < ___% (부하 테스트)
- N+1 / full-scan: 0건
- 부하 capacity: ≥ 예상 × ___

### 정성

- [ ] Failure mode ≥ 3개 식별
- [ ] High-reversibility 결정에 ADR
- [ ] 1인 운영 가능성 검토
"""


RETRO = """# Retrospective — {name}

> 사이클 *종료 시* 작성. 종료 전엔 비워둠.
> 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로), [`think:retrospective`]

## 무엇을 배웠나

- ___

## 놀란 것 (예측 vs 실제)

- ___

## 다음에 바꿀 것

- ___

## 인계 (살림 / 의심 / 버림)

- 살림: ___
- 의심: ___
- 버림: ___

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- ___
"""


METRICS_SKELETON = {
    "cycle_id": "",
    "started_at": "",
    "current_phase": "analysis",  # analysis→design→planning→implementation→validation. AI가 행동 전 확인 (P6/P9).
    "phase_status": {
        "analysis": "in-progress",
        "design": "todo",
        "planning": "todo",
        "implementation": "todo",
        "validation": "todo",
    },
    "phase_gates": {
        # phase-advance.py 가 소비하는 최소 운영 계약. evidence 는 전진 시 --evidence 로 채운다.
        # docs/** 같은 넓은 위치는 cycle-card 에 사람이 읽는 안내로 두고, 실제 게이트는 파일 존재로 검증한다.
        "analysis": {"type": "solo", "evidence": [], "user_confirmed": True},
        "design": {"type": "collaborative", "evidence": [], "user_confirmed": False},
        "planning": {"type": "collaborative", "evidence": [], "user_confirmed": False},
        "implementation": {"type": "solo", "evidence": [], "user_confirmed": True},
        "validation": {"type": "solo", "evidence": [], "user_confirmed": True},
    },
    "appetite_sessions": 1,   # 작업 세션 단위 (cycle-004). retro 시 session_count 와 수동 대조(kill-check 은퇴 #015).
    "session_count": 1,       # 사이클 생성 세션 = 1. 이후 SessionStart hook 이 자동 증가.
    "reentry_count": 0,       # Inferential — 게이트/사람이 단계 재진입 시 증가.
    "gate1_status": "pending",
    "gate2_status": "pending",
    # kill_check 필드 제거 (#015): kill-check.py 은퇴 + 읽는 코드 0 → vestigial.
}


def slugify(name: str) -> str:
    out = "".join(c if c.isalnum() else "-" for c in name.lower())
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-") or "unnamed"


def check_wip(force: bool) -> None:
    if not ACTIVE_LINK.exists():
        return
    target = ACTIVE_LINK.resolve() if ACTIVE_LINK.is_symlink() else ACTIVE_LINK
    msg = (
        f"WIP=1 위반: 이미 active 사이클이 있습니다 — {target.name}\n"
        f"  현재 사이클을 *명시적으로 종료*한 뒤 새 사이클 시작.\n"
        f"  관련: SD-03, AP-12 WIP explosion.\n"
        f"  강행 시: --force (ADR 작성 권장)"
    )
    if force:
        print(f"[WARN] {msg}\n[--force 지정으로 진행]", file=sys.stderr)
        return
    print(f"ERROR:\n{msg}", file=sys.stderr)
    sys.exit(1)


def set_active(cdir: Path) -> None:
    if ACTIVE_LINK.exists() or ACTIVE_LINK.is_symlink():
        ACTIVE_LINK.unlink()
    # 상대 symlink — 이식성
    ACTIVE_LINK.symlink_to(cdir.name, target_is_directory=True)


def report_wip() -> None:
    """--check-wip: report active cycle without creating anything. exit 1 if active."""
    if not ACTIVE_LINK.exists() and not ACTIVE_LINK.is_symlink():
        print("WIP OK: active 사이클 없음 — 새 사이클 시작 가능")
        sys.exit(0)
    target = ACTIVE_LINK.resolve() if ACTIVE_LINK.is_symlink() else ACTIVE_LINK
    print(
        f"WIP=1: 이미 active 사이클이 있습니다 — {target.name}\n"
        f"  새 사이클 전에 현재 사이클을 *명시적으로 종료* (SD-03, AP-12).",
        file=sys.stderr,
    )
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Initialize a new harness cycle")
    parser.add_argument("name", nargs="?", help="Cycle name (will be slugified)")
    parser.add_argument(
        "--check-wip",
        action="store_true",
        help="Only report WIP status; do not create a cycle",
    )
    parser.add_argument(
        "--type",
        choices=["product", "dev-tool", "exploration"],
        default="product",
        help="Cycle type — gate adapts per type (09 §9.1b). Default: product",
    )
    parser.add_argument("--force", action="store_true", help="Bypass WIP=1 check")
    args = parser.parse_args()

    if args.check_wip:
        report_wip()
        return

    if not args.name:
        parser.error("name is required unless --check-wip is given")

    CYCLES_DIR.mkdir(exist_ok=True)
    check_wip(args.force)

    today = date.today().strftime("%Y%m%d")
    slug = slugify(args.name)
    cid = f"{today}-{slug}"
    cdir = CYCLES_DIR / cid

    if cdir.exists():
        print(f"ERROR: cycle already exists: {cdir}", file=sys.stderr)
        sys.exit(1)

    cdir.mkdir(parents=True)
    ctype_label = {"product": "Product", "dev-tool": "Dev-tool", "exploration": "Exploration"}[args.type]
    ctx = {"name": args.name, "cid": cid, "start": today, "ctype": ctype_label}

    (cdir / "cycle-card.md").write_text(CYCLE_CARD.format(**ctx), encoding="utf-8")
    (cdir / "pre-mortem.md").write_text(PRE_MORTEM.format(**ctx), encoding="utf-8")
    (cdir / "gate-criteria.md").write_text(GATE_CRITERIA.format(**ctx), encoding="utf-8")
    (cdir / "retro.md").write_text(RETRO.format(**ctx), encoding="utf-8")
    (cdir / "findings.md").write_text(FINDINGS.format(**ctx), encoding="utf-8")
    (cdir / "hypotheses.jsonl").touch()
    (cdir / "blackbox.jsonl").touch()
    (cdir / "bar.jsonl").touch()
    (cdir / "review.jsonl").touch()
    (cdir / "activity.log").touch()

    metrics = METRICS_SKELETON.copy()
    metrics["cycle_id"] = cid
    metrics["started_at"] = today
    (cdir / "metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    set_active(cdir)

    print(f"INITIALIZED cycle: {cdir}")
    print(f"  → cycles/active linked to this cycle")
    print()
    print("다음 단계:")
    print(f"  1. {cdir}/cycle-card.md — hypotheses/persona/kill criteria 채우기")
    print(f"  2. {cdir}/pre-mortem.md — 6개월 뒤 실패 시나리오 5개")
    print(f"  3. {cdir}/gate-criteria.md — Gate 1·2 수치 고정")
    print(f"  4. 각 가설 등록 (tamper-evident):")
    print(f"       scripts/hypothesis-register.py register --cycle {cid} --id H1 \\")
    print(f"         --hypothesis '...' --kill-line '...' --pass-line '...'")
    print(f"  5. 각 품질 바 잠금:")
    print(f"       scripts/bar-register.py register --cycle {cid} --id B1 --stage test \\")
    print(f"         --criterion '...' --measure '...'")
    print(f"  6. (종료 시) 독립 리뷰어(fresh subagent)가 각 바를 채점 → 종료:")
    print(f"       scripts/review-register.py register --cycle {cid} --id R1 --criterion-id B1 \\")
    print(f"         --verdict pass --evidence '...' --reviewer 'subagent:...'")
    print(f"       scripts/close-cycle.py            # active 기준 — --cycle 인자 없음 (#007)")


if __name__ == "__main__":
    main()
