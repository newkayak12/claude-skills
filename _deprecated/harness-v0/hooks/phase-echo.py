#!/usr/bin/env python3
"""
phase-echo.py — UserPromptSubmit hook. active 사이클의 *현재 phase* 인식을 플로우 내부로 환기.

왜 (real-use feedback #4·#7, feedback-processed.md):
  cycle/SKILL.md 와 phase-advance.py 가 phase 추적·전환 게이트를 *이미* 갖췄는데도, 06-23
  실사용에서 AI 가 "현재 어느 phase 인지" 인식 못 하고 단계 전환을 사용자가 "쭉 넘어가자"
  해야 진행했다. SKILL 본문은 세션 시작 컨텍스트에 한 번 들어갔다가 긴 플로우에서
  스크롤아웃·compaction 에 먹힌다 — *마찰이 일어나는 지점에 환기점이 없었다*.

  이 hook 은 매 user turn 직전, active cycle 의 current_phase 를 읽어 phase 인식을 주입한다.
  단 **phase 가 직전 주입과 달라졌을 때만**(전환 시점) 쏜다 — 같은 phase 를 매 턴 반복 주입하면
  스팸이다(stage-inject 와 동일 de-dup 철학, 단 마커가 *phase 값*을 저장해 값 비교).

설계 경계 (stage-inject 와 동일):
  *주입 ≠ 강제*. soft 안내다. 진짜 evidence/confirm 강제는 phase-advance.py 게이트 몫.
  이 hook 은 "기억 의존 대신 플로우 내부 도달"만 개선한다.

Protocol (UserPromptSubmit):
  stdin  = UserPromptSubmit event JSON (session_id 등)
  stdout = plain text (exit 0) → 컨텍스트로 주입된다 (SessionStart/UserPromptSubmit 규약).
  active 없음 / 동일 phase / 파싱 실패 → 무출력 exit 0 (fail-open).

Wiring (hooks.json):
  "UserPromptSubmit": [ { "hooks": [ { "type": "command",
    "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-echo.py" } ] } ]
"""
import hashlib
import json
import os
import sys
from pathlib import Path

CYCLES = Path("cycles")
ACTIVE = CYCLES / "active"
PHASES = ["analysis", "design", "planning", "implementation", "validation"]


def harness_home() -> Path:
    """stage-inject.py / rules-merge.py 와 동일 규약."""
    return Path(os.environ.get("HARNESS_HOME", str(Path.home() / ".harness")))


def read_event() -> dict:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def active_metrics():
    """active 사이클의 metrics.json 을 로드. 없으면 None."""
    if not ACTIVE.exists() and not ACTIVE.is_symlink():
        return None
    try:
        cid = Path(os.readlink(ACTIVE) if ACTIVE.is_symlink() else ACTIVE.name).name
    except OSError:
        return None
    mp = CYCLES / cid / "metrics.json"
    if not mp.exists():
        return None
    try:
        return json.loads(mp.read_text(encoding="utf-8"))
    except Exception:
        return None


def marker_path(session_id: str):
    """세션-스코프 마커 — *직전 주입한 phase 값*을 저장. session_id 없으면 None."""
    if not session_id:
        return None
    sid = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:16]
    return harness_home() / "phase-echo" / sid / "last-phase"


def last_injected(marker) -> str:
    if marker is None or not marker.exists():
        return ""
    try:
        return marker.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def mark_injected(marker, phase: str) -> None:
    if marker is None:
        return
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(phase, encoding="utf-8")
    except Exception:
        pass  # fail-open — 마커 못 써도 막지 않는다 (최악: 다음 턴 1회 더 주입)


def compose(phase: str, gate: dict) -> str:
    is_collab = (gate.get("type") == "collaborative")
    nxt = PHASES[PHASES.index(phase) + 1] if phase in PHASES and phase != PHASES[-1] else None

    lines = [
        f"[harness] active cycle phase = **{phase}** (안내일 뿐 — 진짜 게이트는 phase-advance.py):",
        "  - 행동 전 현재 phase 확인. 이 phase 작업만 — 단계 스킵/혼합 금지 (P9).",
    ]
    if is_collab:
        lines.append("  - collaborative phase: 산출물은 draft→review→finalize. AI 혼자 final 금지. "
                     "떠나려면 phase-advance.py --evidence <파일> --confirm-user --confirmation-note \"<합의 내용>\".")
    else:
        lines.append("  - solo phase: AI 진행 후 보고. 떠나려면 phase-advance.py --evidence <내용 있는 산출물 파일>.")
    lines.append("  - 산출물은 *파일*로 (채팅 표 != 산출물, P8).")
    if nxt:
        lines.append(f"  - 산출물 완료 시 다음 phase('{nxt}') 전환을 **AI 가 먼저 제안**할 것 "
                     "(사용자가 '쭉 넘어가자' 해야 진행 = AI 실패).")
    return "\n".join(lines)


def main():
    event = read_event()
    session_id = event.get("session_id", "") if isinstance(event, dict) else ""

    metrics = active_metrics()
    if metrics is None:
        sys.exit(0)  # active 사이클 없음 — no-op

    phase = metrics.get("current_phase", "analysis")
    marker = marker_path(session_id)
    if last_injected(marker) == phase:
        sys.exit(0)  # 같은 phase — 이미 환기함, 스팸 금지

    gate = (metrics.get("phase_gates") or {}).get(phase) or {}
    mark_injected(marker, phase)  # 주입 전 표시 — 경쟁 시 중복 최소화
    print(compose(phase, gate))
    sys.exit(0)


if __name__ == "__main__":
    main()
