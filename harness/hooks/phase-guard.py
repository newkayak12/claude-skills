#!/usr/bin/env python3
"""
phase-guard.py — PreToolUse hook (Böckeler *Sensor*, 차단).

active 사이클이 없거나 `current_phase` 가 implementation/validation 이 아닐 때 *코드 파일* 편집을 차단한다.
implementation/validation 이어도 analysis/design/planning evidence와 collaborative user confirmation이
검증된 `phase.jsonl` chain 에 없으면 코드 파일 편집을 차단한다.
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

신뢰 앵커 (H1 — #013b H3 kill-line 해소):
  phase-guard 는 metrics.json 이 아니라 tamper-evident `phase.jsonl` chain 에서 current_phase·
  게이트를 도출한다. 이 체인의 유일 기록자는 phase-advance.py 이고, hypothesis-immutability 가
  직접 Edit 을, verify_chain 이 Bash append 를, "부재→차단" 이 삭제를 막는다. 따라서
  metrics.json 직접편집·체인 손상으로는 게이트를 열 수 없다(체인 깨짐 → 전면 차단).
  한계(bars·hypotheses 와 동일): Bash 로 유효 해시 체인을 통째로 위조하는 결정형 공격까지는
  막지 못한다 — 솔로-dev 위협모델 밖(tamper-evident ≠ 암호서명).

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


def _project_root() -> Path:
    """프로젝트 루트. CLAUDE_PROJECT_DIR(Claude Code 가 hook 에 주입) 우선, 없으면 CWD.

    hook 은 임의 CWD(서브디렉토리 포함)에서 호출될 수 있다. cycles/·evidence 경로를
    CWD 상대로 풀면 ① 하위디렉토리에서 active cycle 을 못 찾아 *과차단*, ② chain 에
    기록된 상대 evidence 경로(`docs/analysis.md`)를 못 찾아 게이트를 잘못 닫는 *간헐 실패*
    가 난다. 둘 다 루트를 프로젝트 기준으로 절대화하면 동시에 해소된다(feedbacklib·
    project-install 의 CLAUDE_PROJECT_DIR 패턴과 동형).
    """
    root = os.environ.get("CLAUDE_PROJECT_DIR")
    if root:
        try:
            return Path(root)
        except Exception:
            pass
    return Path.cwd()


PROJECT_ROOT = _project_root()
CYCLES = PROJECT_ROOT / "cycles"
ACTIVE = CYCLES / "active"

CODE_ALLOWED_PHASES = {"implementation", "validation"}
REQUIRED_PRE_CODE_PHASES = ("analysis", "design", "planning")
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
# 코드 = 소스 확장자. .md/.txt/.json/.yaml/.toml/.cfg 등 설계·설정·문서는 통과.
# .ipynb 는 코드로 간주(NotebookEdit). 확장자 매칭은 모두 대소문자 무시(.PY 우회 차단).
CODE_EXTS = {
    ".py", ".sh", ".kt", ".kts", ".js", ".ts", ".jsx", ".tsx",
    ".java", ".go", ".rs", ".rb", ".c", ".cc", ".cpp", ".h", ".hpp",
    ".cs", ".php", ".swift", ".scala", ".clj", ".ex", ".exs", ".sql",
    ".ipynb", ".mjs", ".cjs", ".pyi", ".pyx", ".lua", ".dart",
    ".vue", ".svelte", ".m", ".r", ".jl", ".hs",
}
TECH_DECISION_DOC_RE = re.compile(
    r"(^|[/_.-])(adr|rfc|srs|design[-_ ]?doc|architecture|arch|model|schema|data[-_ ]?model)([/_.-]|$)",
    re.IGNORECASE,
)


CODE_EXT_PATTERN = r"(?:{})(?:\s|$|['\"])?".format(
    "|".join(re.escape(ext) for ext in sorted(CODE_EXTS, key=len, reverse=True))
)
# 인터프리터 인라인 코드작성 탐지: 코드를 *문자열로 받아 즉시 실행* 하면서 파일에 쓰는 패턴.
#   python3 -c "open('app.py','w')...", perl -i, node -e "...writeFileSync...", ruby/php -e ...
# 두 조각이 모두 한 명령에 있어야 차단: ① 인터프리터+코드주입/인플레이스 플래그, ② 쓰기 시그널.
# 쓰기 시그널 = 코드확장자 경로 토큰 | open(...,'w'/'a') | writeFileSync/File.write | -i/-p -i.
# python3 -c "print(1)" 처럼 쓰기 시그널이 없으면 통과(allow-case 보존).
_INTERP = r"(?:python[0-9.]*|perl|node|ruby|php)"
_WRITE_SIGNAL = (
    r"(?:"
    + CODE_EXT_PATTERN  # app.py / x.kt / a.PY(IGNORECASE) ...
    + r"|open\s*\([^)]*['\"][wa]"  # open('app.py','w'/'a')
    + r"|writeFileSync|appendFileSync|createWriteStream"  # node fs
    + r"|File\.(?:write|open|new)"  # ruby File.write / File.open(...,'w')
    + r"|file_put_contents|fopen\s*\([^)]*['\"][wa]"  # php
    + r")"
)
BASH_WRITE_PATTERNS = [
    # 모든 리다이렉트(평문 >, fd-prefix 2>, &>, >|, >>)가 코드확장자 파일을 대상으로 할 때.
    #   echo x 1> app.py / cat > app.PY / : > f.py 등. \d* 로 fd-prefix, [|]? 로 >| 흡수.
    re.compile(r"(?:^|\s|;)\d*(?:&)?>{1,2}[|]?\s*\S*" + CODE_EXT_PATTERN, re.IGNORECASE),
    re.compile(r"(?:^|\s)tee(?:\s+-a)?\s+\S+" + CODE_EXT_PATTERN, re.IGNORECASE),
    re.compile(r"(?:^|\s)(?:touch|cp|mv|install)\b[^\n;|&]*\S+" + CODE_EXT_PATTERN, re.IGNORECASE),
    re.compile(r"(?:^|\s)sed\s+-i\b[^\n;|&]*\S+" + CODE_EXT_PATTERN, re.IGNORECASE),
    # dd of=app.py
    re.compile(r"(?:^|\s)dd\b[^\n;|&]*\bof=\S*" + CODE_EXT_PATTERN, re.IGNORECASE),
    # git apply / patch (코드 확장자 파일을 패치로 생성·변경)
    re.compile(r"(?:^|\s)git\s+apply\b", re.IGNORECASE),
    re.compile(r"(?:^|\s)patch\b[^\n;|&]*(?:-p\d|<|\S+" + CODE_EXT_PATTERN + r")", re.IGNORECASE),
    # 인터프리터 인라인 실행 + 쓰기 시그널 (순서 무관: 코드 안에서 플래그/경로가 뒤따름)
    # 플래그 char class: python -c, node/ruby/perl -e, perl -i/-p, php -r/-R.
    #   php 의 인라인 코드 플래그는 -r/-R 뿐이라 r 가 빠지면 php 가 _INTERP 에 있어도
    #   file_put_contents/fopen 쓰기를 전혀 못 잡는다(미차단 갭). 쓰기 시그널이 여전히
    #   필수라 `php -r "echo 1;"` 같은 비쓰기 인라인은 통과(allow 보존).
    re.compile(_INTERP + r"\b[^\n;|&]*\s-[a-z]*[ceipr][^\n]*" + _WRITE_SIGNAL, re.IGNORECASE),
    # perl/ruby/sed 류 in-place: `perl -i`, `perl -pi -e`, `ruby -i` + 코드확장자 인자
    re.compile(_INTERP + r"\b[^\n;|&]*\s-[a-z]*i[a-z]*\b[^\n;|&]*\S*" + CODE_EXT_PATTERN, re.IGNORECASE),
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


def _import_chainlog():
    """scripts/chainlog 를 sys.path 에 얹어 import. 실패 시 None (fail-soft)."""
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
        import chainlog
        return chainlog
    except Exception:
        return None


def _active_cycle_dir():
    if not ACTIVE.exists():
        return None
    cid = Path(os.readlink(ACTIVE) if ACTIVE.is_symlink() else ACTIVE.name).name
    d = CYCLES / cid
    return d if d.exists() else None


def _evidence_exists(p: str) -> bool:
    """chain 에 기록된 evidence 경로 존재 확인. 상대경로는 PROJECT_ROOT 기준으로 푼다.

    phase-advance 는 사용자가 넘긴 경로(보통 `docs/analysis.md` 같은 프로젝트 루트 상대)를
    그대로 chain 에 기록한다. hook 이 임의 CWD 에서 호출되면 CWD 상대 해석은 존재하는
    evidence 를 놓쳐 게이트를 잘못 닫는다(간헐 실패). 절대경로는 그대로, 상대경로만 루트 기준.
    """
    path = Path(p)
    if path.is_absolute():
        return path.exists()
    return (PROJECT_ROOT / path).exists() or path.exists()


def _phase_state():
    """검증된 phase.jsonl chain 에서 (current_phase, pre_code_problems, tampered) 도출 (H1).

    phase-guard 의 신뢰 앵커를 *자유 편집 가능한 metrics.json* 에서 *tamper-evident chain* 으로
    옮긴다. metrics.current_phase/phase_gates 직접편집은 더 이상 게이트를 못 연다 — 여기서
    metrics 를 읽지 않기 때문.
      - active cycle 없음 → (None, [], False)
      - phase.jsonl 부재/삭제 → analysis 취급(코드 차단), 안내만
      - chain 깨짐/위조/파싱실패 → (None, problems, tampered=True) → 코드·tech-doc 전부 차단
      - 정상 → chain head 의 to = current_phase, completed_phase 별 evidence/confirm 재생
    """
    cdir = _active_cycle_dir()
    if cdir is None:
        return None, [], False
    chain = cdir / "phase.jsonl"
    cl = _import_chainlog()
    if cl is None:
        return "analysis", ["chainlog 로드 실패 — 체인 검증 불가(코드 차단)"], False
    ok, _count, err = cl.verify_chain(chain)
    if not ok:
        if err and "file not found" in err:
            return "analysis", ["phase.jsonl 없음 — phase-advance 로 단계를 기록해야 한다"], False
        return None, [f"phase chain 무결성 실패({err}) — 위조 의심"], True
    cur = "analysis"
    completed = {}
    for line in chain.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            e = json.loads(line)
        except Exception:
            return None, ["phase chain JSON 파싱 실패 — 위조 의심"], True
        cur = e.get("to", cur)
        cp = e.get("completed_phase")
        if cp:
            completed[cp] = e
    problems = []
    for phase in REQUIRED_PRE_CODE_PHASES:
        e = completed.get(phase)
        if not isinstance(e, dict):
            problems.append(f"{phase}: 완료 기록 없음(phase-advance 미경유)")
            continue
        evidence = [p for p in (e.get("evidence") or []) if isinstance(p, str) and _evidence_exists(p)]
        if not evidence:
            problems.append(f"{phase}: evidence 파일 없음")
        if e.get("collaborative") and not e.get("user_confirmed"):
            problems.append(f"{phase}: 사용자 confirm 없음")
    return cur, problems, False


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

    phase, pre_code_problems, tampered = _phase_state()
    active = _active_cycle_dir() is not None

    # tech decision 문서: *무결한* active cycle 안에서만 허용 (위조 체인이면 차단)
    if doc_target and not code_target:
        if active and not tampered:
            sys.exit(0)

    gate_problems = []
    if code_target and not tampered and phase in CODE_ALLOWED_PHASES:
        gate_problems = pre_code_problems
        if not gate_problems:
            sys.exit(0)

    phase_label = "tampered" if tampered else (phase or "no-active-cycle")
    target = code_target or doc_target
    kind = "code" if code_target else "tech-decision-doc"

    # 차단 — 마찰 기록 후 exit 2
    fb = _import_feedbacklib()
    if fb is not None:
        fb.record("phase-guard", f"blocked-{kind}-outside-harness",
                  f"phase={phase_label} tool={tool} target={target}",
                  phase=phase_label, tool=tool, target=target, kind=kind)
    if tampered:
        guidance = (
            "   phase.jsonl 체인 무결성 검증 실패(위조/손상) — 코드·tech-doc 변경을 모두 차단한다.\n"
            + "".join(f"     - {p}\n" for p in pre_code_problems)
            + "   단계는 phase-advance.py 로만 기록돼야 한다. metrics.json 직접편집·체인 손상은 게이트를 열지 못한다(H1).\n"
        )
    elif phase is None:
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
            "     python3 <plugin>/scripts/phase-advance.py planning --evidence docs/design.md --confirm-user --confirmation-note \"<합의 내용>\"\n"
            "     python3 <plugin>/scripts/phase-advance.py implementation --evidence docs/plan.md --confirm-user --confirmation-note \"<합의 내용>\"\n"
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
