#!/usr/bin/env python3
"""
phase-guard.py — PreToolUse hook (Böckeler *Sensor*, 차단).

active 사이클의 `current_phase` 가 design/planning 일 때 *코드 파일* 편집을 차단한다.
R-PG01 "No code before design" 을 soft 권고(rule-inject)에서 *물리 게이트*로 끌어올린다.

왜 차단인가:
  rule-inject 가 R-PG01 을 컨텍스트에 주입해도 모델이 속도 우선으로 어긴다(실사용 피드백,
  cycle/SKILL Step6 의 collaborative 게이트가 그 증거). *주입 ≠ 강제* — 진짜 강제는
  차단성 hook (원칙2). hypothesis-immutability(데이터)·active-symlink-guard(종료)와 동형:
  이번엔 *단계 순서*(설계 전 코딩 금지)를 물리로 못박는다.

무엇이 코드인가:
  design/planning 산출물은 .md(설계문서·ADR·로드맵)·설정. 소스 확장자(.py/.kt/...)는
  아직 이르다 → 차단. 비코드(.md/.json/.yaml/...)는 통과 — 설계문서 작성을 막지 않는다.

차단 시 feedbacklib 로 `.claude/.feedback` 에 마찰 기록(beta report 원료).

정직한 한계 (#013b H3 kill-line):
  current_phase 의 정당 전환은 `phase-advance.py`. metrics.json 직접편집 우회는 못 막는다
  (active-symlink-guard 가 mv 못 막듯). 전환 무결성 강화는 후속 사이클.

Wiring (hooks.json):
  "PreToolUse": matcher "Edit|Write|MultiEdit" → phase-guard.py

Protocol:
  current_phase ∈ {design,planning} + 코드 확장자 → exit 2 (차단).
  그 외 / 모든 예외 → exit 0 (fail-open). 정당 작업을 막지 않는다.
"""
import json
import os
import sys
from pathlib import Path

CYCLES = Path("cycles")
ACTIVE = CYCLES / "active"

GUARDED_PHASES = {"design", "planning"}
EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}
# 코드 = 소스 확장자. .md/.txt/.json/.yaml/.toml/.cfg 등 설계·설정·문서는 통과.
CODE_EXTS = {
    ".py", ".sh", ".kt", ".kts", ".js", ".ts", ".jsx", ".tsx",
    ".java", ".go", ".rs", ".rb", ".c", ".cc", ".cpp", ".h", ".hpp",
    ".cs", ".php", ".swift", ".scala", ".clj", ".ex", ".exs", ".sql",
}


def _import_feedbacklib():
    """scripts/feedbacklib 을 sys.path 에 얹어 import. 실패 시 None (fail-soft)."""
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    bases = []
    if root:
        bases.append(Path(root) / "scripts")
    bases.append(Path(__file__).resolve().parent.parent / "scripts")
    for base in bases:
        if base.is_dir():
            sys.path.insert(0, str(base))
            break
    try:
        import feedbacklib
        return feedbacklib
    except Exception:
        return None


def _read_input():
    try:
        return json.load(sys.stdin)
    except Exception:
        return None


def _active_phase():
    if not ACTIVE.exists():
        return None
    cid = Path(os.readlink(ACTIVE) if ACTIVE.is_symlink() else ACTIVE.name).name
    mp = CYCLES / cid / "metrics.json"
    if not mp.exists():
        return None
    try:
        return json.loads(mp.read_text(encoding="utf-8")).get("current_phase")
    except Exception:
        return None


def main():
    data = _read_input()
    if not isinstance(data, dict):
        sys.exit(0)
    tool = data.get("tool_name", "")
    if tool not in EDIT_TOOLS:
        sys.exit(0)
    fp = (data.get("tool_input") or {}).get("file_path", "")
    if not fp or Path(fp).suffix.lower() not in CODE_EXTS:
        sys.exit(0)  # 비코드(설계문서·설정) → 통과
    phase = _active_phase()
    if phase not in GUARDED_PHASES:
        sys.exit(0)  # active 없음·phase 비대상 → 통과 (fail-open)

    # 차단 — 마찰 기록 후 exit 2
    fb = _import_feedbacklib()
    if fb is not None:
        fb.record("phase-guard", "blocked-code-edit-in-design",
                  f"phase={phase} tool={tool} file={fp}",
                  phase=phase, tool=tool, file=fp)
    print(
        f"🛑 [phase-guard] 현재 phase='{phase}' — 코드 파일 편집 차단: {fp}\n"
        f"   설계(design)/계획(planning) 단계에선 코드 대신 설계문서(.md)·ADR·로드맵을 쓴다 "
        f"(R-PG01 'No code before design').\n"
        f"   설계가 합의됐으면 phase 를 전진(코딩은 implementation 부터):\n"
        f"     python3 <plugin>/scripts/phase-advance.py implementation\n"
        f"   (이 차단은 .claude/.feedback 에 기록됨)",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
