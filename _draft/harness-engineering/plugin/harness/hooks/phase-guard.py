#!/usr/bin/env python3
"""
phase-guard.py — PreToolUse hook (Böckeler *Sensor*, 차단).

active 사이클이 없거나 `current_phase` 가 implementation/validation 이 아닐 때 *코드 파일* 편집을 차단한다.
implementation/validation 이어도 analysis/design/planning evidence와 collaborative user confirmation이
metrics.json `phase_gates`에 없으면 코드 파일 편집을 차단한다.
아키텍처/모델/ADR/Design Doc 같은 tech decision 문서는 코드가 아니어도 active cycle 없이는 차단한다.
R-PG01 "No code before design" 을 soft 권고(rule-inject)에서 *물리 게이트*로 끌어올린다.

왜 차단인가:
  rule-inject 가 R-PG01 을 컨텍스트에 주입해도 모델이 속도 우선으로 어긴다(실사용 피드백,
  cycle/SKILL Step6 의 collaborative 게이트가 그 증거). *주입 ≠ 강제* — 진짜 강제는
  차단성 hook (원칙2). hypothesis-immutability(데이터)·active-symlink-guard(종료)와 동형:
  이번엔 *단계 순서*(설계 전 코딩 금지)를 물리로 못박는다.

무엇을 막는가:
  analysis/design/planning 산출물은 .md(분석노트·설계문서·ADR·로드맵)·설정. 소스 확장자(.py/.kt/...)는
  아직 이르다 → 차단. 비코드(.md/.json/.yaml/...)는 통과 — 설계문서 작성을 막지 않는다.
  단, tech decision 문서(adr/design-doc/architecture/model/schema/rfc/srs 이름·경로)는 active cycle
  없이는 차단한다. 아키텍처·모델 변경 문서도 하네스 안에서 추적되어야 하기 때문이다.

차단 시 feedbacklib 로 `.claude/.feedback` 에 마찰 기록(beta report 원료).

정직한 한계 (#013b H3 kill-line):
  current_phase 의 정당 전환은 `phase-advance.py`. active cycle 이 없으면 코드 변경을 막아
  하네스 밖 작업을 차단한다. metrics.json 직접편집으로 phase만 바꿔도 phase_gates evidence가
  없으면 코드 변경은 계속 차단한다.

Wiring (hooks.json):
  "PreToolUse": matcher "Edit|Write|MultiEdit|NotebookEdit|Bash" → phase-guard.py

Protocol:
  active 없음 / current_phase ∉ {implementation,validation} + 코드 확장자 편집/생성 → exit 2 (차단).
  current_phase ∈ {implementation,validation} 이라도 phase_gates 미충족 + 코드 확장자 편집/생성 → exit 2.
  active 없음 + tech decision 문서 편집/생성 → exit 2 (차단).
  일반 비코드 / implementation·validation / active cycle 내부 문서작업 / 모든 예외 → exit 0.
"""
import json
import os
import re
import sys
from pathlib import Path

CYCLES = Path("cycles")
ACTIVE = CYCLES / "active"

CODE_ALLOWED_PHASES = {"implementation", "validation"}
REQUIRED_PRE_CODE_PHASES = ("analysis", "design", "planning")
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
# 코드 = 소스 확장자. .md/.txt/.json/.yaml/.toml/.cfg 등 설계·설정·문서는 통과.
CODE_EXTS = {
    ".py", ".sh", ".kt", ".kts", ".js", ".ts", ".jsx", ".tsx",
    ".java", ".go", ".rs", ".rb", ".c", ".cc", ".cpp", ".h", ".hpp",
    ".cs", ".php", ".swift", ".scala", ".clj", ".ex", ".exs", ".sql",
}
TECH_DECISION_DOC_RE = re.compile(
    r"(^|[/_.-])(adr|rfc|srs|design[-_ ]?doc|architecture|arch|model|schema|data[-_ ]?model)([/_.-]|$)",
    re.IGNORECASE,
)


CODE_EXT_PATTERN = r"(?:{})(?:\s|$|['\"])?".format(
    "|".join(re.escape(ext) for ext in sorted(CODE_EXTS, key=len, reverse=True))
)
BASH_WRITE_PATTERNS = [
    re.compile(r"(?:^|\s)(?:>|>>)\s*\S+" + CODE_EXT_PATTERN),
    re.compile(r"(?:^|\s)tee(?:\s+-a)?\s+\S+" + CODE_EXT_PATTERN),
    re.compile(r"(?:^|\s)(?:touch|cp|mv|install)\b[^\n;|&]*\S+" + CODE_EXT_PATTERN),
    re.compile(r"(?:^|\s)sed\s+-i\b[^\n;|&]*\S+" + CODE_EXT_PATTERN),
]
BASH_DOC_WRITE_PATTERNS = [
    re.compile(r"(?:^|\s)(?:>|>>)\s*(\S+\.md)(?:\s|$|['\"])?", re.IGNORECASE),
    re.compile(r"(?:^|\s)tee(?:\s+-a)?\s+(\S+\.md)(?:\s|$|['\"])?", re.IGNORECASE),
    re.compile(r"(?:^|\s)(?:touch|cp|mv|install)\b[^\n;|&]*(\S+\.md)(?:\s|$|['\"])?", re.IGNORECASE),
]


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


def _active_metrics():
    if not ACTIVE.exists():
        return None
    cid = Path(os.readlink(ACTIVE) if ACTIVE.is_symlink() else ACTIVE.name).name
    mp = CYCLES / cid / "metrics.json"
    if not mp.exists():
        return None
    try:
        metrics = json.loads(mp.read_text(encoding="utf-8"))
        return metrics if isinstance(metrics, dict) else None
    except Exception:
        return None


def _active_phase():
    metrics = _active_metrics()
    if metrics is None:
        return None
    return metrics.get("current_phase")


def _phase_gate_problems(metrics: dict | None) -> list[str]:
    if not isinstance(metrics, dict):
        return ["metrics.json 없음/파싱 실패"]
    gates = metrics.get("phase_gates")
    if not isinstance(gates, dict):
        return ["phase_gates 없음 — phase-advance evidence/user-confirm 검증 불가"]

    problems = []
    for phase in REQUIRED_PRE_CODE_PHASES:
        gate = gates.get(phase)
        if not isinstance(gate, dict):
            problems.append(f"{phase}: gate 없음")
            continue
        evidence = gate.get("evidence") or []
        existing = [p for p in evidence if isinstance(p, str) and Path(p).exists()]
        if not existing:
            problems.append(f"{phase}: evidence 파일 없음")
        if gate.get("type") == "collaborative" and not gate.get("user_confirmed"):
            problems.append(f"{phase}: 사용자 confirm 없음")
    return problems


def _code_target_from_event(tool: str, tool_input: dict) -> str | None:
    if tool in EDIT_TOOLS:
        fp = tool_input.get("file_path", "")
        if fp and Path(fp).suffix.lower() in CODE_EXTS:
            return fp
        return None
    if tool == "Bash":
        cmd = tool_input.get("command", "")
        if not isinstance(cmd, str):
            return None
        for pat in BASH_WRITE_PATTERNS:
            m = pat.search(cmd)
            if m:
                return m.group(0).strip()
    return None


def _doc_target_from_event(tool: str, tool_input: dict) -> str | None:
    if tool in EDIT_TOOLS:
        fp = tool_input.get("file_path", "")
        if fp and Path(fp).suffix.lower() == ".md" and TECH_DECISION_DOC_RE.search(fp):
            return fp
        return None
    if tool == "Bash":
        cmd = tool_input.get("command", "")
        if not isinstance(cmd, str):
            return None
        for pat in BASH_DOC_WRITE_PATTERNS:
            m = pat.search(cmd)
            if m and TECH_DECISION_DOC_RE.search(m.group(1)):
                return m.group(1)
    return None


def main():
    data = _read_input()
    if not isinstance(data, dict):
        sys.exit(0)
    tool = data.get("tool_name", "")
    if tool not in EDIT_TOOLS and tool != "Bash":
        sys.exit(0)
    tool_input = data.get("tool_input") or {}
    code_target = _code_target_from_event(tool, tool_input)
    doc_target = _doc_target_from_event(tool, tool_input)
    if not code_target and not doc_target:
        sys.exit(0)  # 일반 비코드(노트·설정) → 통과
    metrics = _active_metrics()
    phase = metrics.get("current_phase") if isinstance(metrics, dict) else None
    if doc_target and phase is not None and not code_target:
        sys.exit(0)  # tech decision 문서도 active cycle 내부면 허용
    gate_problems = []
    if code_target and phase in CODE_ALLOWED_PHASES:
        gate_problems = _phase_gate_problems(metrics)
        if not gate_problems:
            sys.exit(0)
    phase_label = phase or "no-active-cycle"
    target = code_target or doc_target
    kind = "code" if code_target else "tech-decision-doc"

    # 차단 — 마찰 기록 후 exit 2
    fb = _import_feedbacklib()
    if fb is not None:
        fb.record("phase-guard", f"blocked-{kind}-outside-harness",
                  f"phase={phase_label} tool={tool} target={target}",
                  phase=phase_label, tool=tool, target=target, kind=kind)
    if phase is None:
        guidance = (
            "   active cycle 이 없습니다. 코드/tech decision 작업 전에 하네스 사이클을 시작하세요:\n"
            "     python3 <plugin>/scripts/cycle-init.py \"<cycle-name>\" --type <product|dev-tool|exploration>\n"
        )
    else:
        gate_guidance = ""
        if gate_problems:
            gate_guidance = (
                "   phase는 implementation/validation 이지만 pre-code gate가 미충족입니다:\n"
                + "".join(f"     - {p}\n" for p in gate_problems)
            )
        guidance = (
            f"{gate_guidance}"
            "   각 phase 산출물을 파일로 남기고 정당 경로로 implementation 까지 전진해야 한다:\n"
            "     python3 <plugin>/scripts/phase-advance.py design --evidence docs/analysis.md\n"
            "     python3 <plugin>/scripts/phase-advance.py planning --evidence docs/design.md --confirm-user\n"
            "     python3 <plugin>/scripts/phase-advance.py implementation --evidence docs/plan.md --confirm-user\n"
        )
    print(
        f"🛑 [phase-guard] phase='{phase_label}' — 하네스 밖 {kind} 변경 차단: {target}\n"
        f"   코드 변경은 active cycle 의 implementation/validation phase 에서만 허용된다.\n"
        f"   tech decision 문서는 active cycle 내부에서만 허용된다.\n"
        f"   그 전에는 분석노트·설계문서(.md)·ADR·로드맵을 하네스 산출물로 남긴다.\n"
        f"{guidance}"
        f"   (이 차단은 .claude/.feedback 에 기록됨)",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
