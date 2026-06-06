#!/usr/bin/env python3
"""
session-counter.py — SessionStart hook (Computational Sensor, *측정*).

active 사이클의 `metrics.json:session_count` 를 *새 세션이 시작될 때마다* 1 증가시킨다.
원래 kill-check 의 시간 지표를 *관측 가능*하게 만든 계기(cycle-004)였으나, kill-check 계열은
#015 에서 은퇴했다(발화 0). 현재 session_count 는 retro·진단용 *계측치*로만 남는다 — 자동 소비자
없음. (session_count 자체의 존속 여부는 metrics SPOF rank4 와 함께 후속 검토.)

설계 결정 (cycle-004):
  - 솔로 개발자의 작업 단위는 *달력 시간*이 아니라 *작업 세션*이다.
    wall-clock 은 사이클을 며칠 방치하면 오탐("시간 200%")하지만, 세션 수는 안 한다.
  - SessionStart 의 source 는 startup/resume/clear/compact 중 하나.
    *새 작업 세션* = "startup" 만 카운트. resume·compact 는 *같은 세션의 연속*,
    clear 는 컨텍스트만 비우는 동일 세션 → 미증가. (가설 H1 pass-line 준수)
  - metrics.json 은 hypothesis-immutability(PreToolUse)의 보호 대상이 아니다
    (그 hook 은 hypotheses.jsonl 만 차단) → 자유롭게 갱신 가능.

Wiring (hooks.json):
  "SessionStart": [ { "hooks": [ { "type": "command",
    "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/session-counter.py" } ] } ]

Protocol:
  exit 0 always (세션 시작을 막지 않는다). 파싱 실패·active 없음 → 조용히 통과 (fail-open).
"""
import json
import sys
from pathlib import Path

CYCLES = Path("cycles")
ACTIVE = CYCLES / "active"

# *새 작업 세션*으로 카운트할 source 값 (resume/compact/clear 는 연속 → 제외)
COUNTED_SOURCES = {"startup"}


def read_source() -> str:
    """SessionStart hook 입력 JSON 에서 source 를 읽는다. 실패 시 '' (미카운트)."""
    try:
        data = json.load(sys.stdin)
    except Exception:
        return ""
    return data.get("source", "") if isinstance(data, dict) else ""


def active_cycle_id():
    if not ACTIVE.exists():
        return None
    cid = ACTIVE.readlink().name if ACTIVE.is_symlink() else ACTIVE.name
    return Path(cid).name


def main():
    source = read_source()
    if source not in COUNTED_SOURCES:
        sys.exit(0)  # resume/compact/clear/알수없음 → 연속 세션, 미증가

    cid = active_cycle_id()
    if cid is None:
        sys.exit(0)  # active 사이클 없음 → 측정 대상 없음

    metrics_path = CYCLES / cid / "metrics.json"
    if not metrics_path.exists():
        sys.exit(0)

    try:
        metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    except Exception:
        sys.exit(0)  # 깨진 metrics → 막지 않는다

    metrics["session_count"] = int(metrics.get("session_count", 0)) + 1
    metrics_path.write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    appetite = metrics.get("appetite_sessions")
    note = f" (appetite {appetite})" if appetite else ""
    print(f"[harness] active cycle '{cid}': session {metrics['session_count']}{note}.")
    sys.exit(0)


if __name__ == "__main__":
    main()
