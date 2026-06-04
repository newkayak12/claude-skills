#!/usr/bin/env python3
"""gc-scan.py — 하네스 자신의 표면 엔트로피 스캐너 (원칙6).

GOLDEN-PRINCIPLES.md 의 각 GP-id 를 1:1 로 검사한다 (선언이지 추론 아님 — #010 §2).
  GP-1  relic 코드 디렉토리 (README 만 남고 코드는 plugin/harness 로 이전)  [watch·probation]
  GP-2  죽은 네비게이션 링크 (](상대경로) 타깃 부재) — draft 루트 + plugin/ 양쪽 [high]
  GP-3  중복 파서 Rule-of-Three watch (선언 레지스트리, 2=watch ≥3=escalate) [watch]
  GP-4  의미적 stale (문서가 *주장*하는 상태 vs 코드 현실) — 결정론 불가, 사람검토 [watch]
  GP-5  아키텍처 복잡도 래칫 (script+hook 수를 축으로 노출, 빼기 없는 더하기 감시) [watch]
  GP-6  orphan hook 파일 (hooks/ 에 존재, hooks.json 미배선) — dead hook 또는 배선 누락 [high]

GP-4 는 *결정론적으로 자동탐지 불가*다(문서 의미 ≠ 코드 의미). 스캐너는 그걸 *대신* 검사하지
않고, GC 의식의 **mandatory 사람/LLM 내용검토** 체크리스트를 리포트에 *상기*시킨다(#011 F1·F2 교훈).
GP-5 는 *측정만* 한다(빼기 강제는 ratchet 축이 함). 둘 다 high-confidence 아님 — 사람 판정.

사용:
  gc-scan.py                       # 전체 리포트 (exit 0)
  gc-scan.py --high-confidence-only # HC 항목만; 남아있으면 exit 2 (fixpoint 게이트/B4)
  gc-scan.py --root <dir>          # 스캔 루트 override (hermetic 테스트용)
  gc-scan.py --complexity-axis     # GP-5 복잡도 수치 한 줄(ratchet 축 값) — exit 0
"""
import argparse
import json as _json
import os
import re
import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
# plugin/harness/scripts/gc-scan.py → parents[3] = draft root (harness-engineering)
DEFAULT_ROOT = _HERE.parents[3]

# plugin 밖에서 코드 canonical 이 plugin/harness/<name> 으로 이전됐는지 비교할 때 쓰는 경로
PLUGIN_HARNESS = "plugin/harness"
# GP-1 스캔에서 건너뛸 디렉토리 (plugin 본체·역사적·생성물·메타)
SKIP_TOP_DIRS = {"plugin", "cycles", "templates", "situational-rules", ".git"}
CODE_EXTS = {".py", ".sh", ".kt", ".kts", ".js", ".ts"}
# GP-2 에서 whitelist (역사적 스냅샷·placeholder 템플릿 — 링크 진부화 허용, 리포트엔 표시)
#  plans/    : 실행 완료된 역사적 기록 (과거 스냅샷)
#  templates/: scaffold 산출물 — XXXX-name.md 등 *의도적* placeholder 경로
LINK_WHITELIST_DIRS = {"plans", "templates"}

# GP-3 선언 레지스트리 — GOLDEN-PRINCIPLES.md GP-3 와 동기화. 중복-우려 그룹.
DUP_REGISTRY = {
    "l0-parser": [
        (f"{PLUGIN_HARNESS}/scripts/ruleslib.py", "parse_l0"),
        (f"{PLUGIN_HARNESS}/scripts/rules-load.py", "parse_rules"),
    ],
}

_LINK_RE = re.compile(r"\]\(([^)]+)\)")
_FENCE_RE = re.compile(r"```.*?```", re.S)
_INLINE_CODE_RE = re.compile(r"`[^`\n]*`")


def _strip_code(text: str) -> str:
    """링크 스캔 전 코드블록·인라인코드 제거 — 코드 안 `](...)` 는 네비 링크가 아님(거짓양성 방지)."""
    text = _FENCE_RE.sub("", text)
    text = _INLINE_CODE_RE.sub("", text)
    return text


class Finding:
    def __init__(self, gp, severity, path, detail):
        self.gp = gp
        self.severity = severity  # "high" | "watch"
        self.path = path
        self.detail = detail

    def __str__(self):
        return f"[{self.gp}/{self.severity}] {self.path} — {self.detail}"


def _has_code(d: Path) -> bool:
    return any(p.suffix in CODE_EXTS for p in d.iterdir() if p.is_file())


def scan_gp1_relic_dirs(root: Path):
    """GP-1: README 만 있고 코드 0 + canonical 이 plugin/harness/<name> 에 있는 relic."""
    out = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or entry.name in SKIP_TOP_DIRS or entry.name.startswith("."):
            continue
        files = [p for p in entry.iterdir() if p.is_file()]
        if not files:
            continue
        readmes = [p for p in files if p.name.lower() == "readme.md"]
        if not readmes or _has_code(entry):
            continue  # 코드가 있으면 relic 아님
        canonical = root / PLUGIN_HARNESS / entry.name
        if canonical.is_dir() and _has_code(canonical):
            n_canon = sum(1 for p in canonical.iterdir() if p.suffix in CODE_EXTS)
            # GP-1 은 watch — 구조적 relic 신호는 *내용 검토를 요구하는 smell*이지 auto-delete 아님.
            # #011 실증: 2건 중 0건이 안전 삭제 대상이었다(scripts/=건강한 signpost,
            # hooks/=상태만 stale). 구조 휴리스틱은 signpost↔relic을 못 가른다 → 사람이 판정.
            out.append(Finding(
                "GP-1", "watch", str(entry.relative_to(root)) + "/",
                f"코드 0개·README만; canonical 은 {PLUGIN_HARNESS}/{entry.name}/ ({n_canon} 코드파일). "
                f"[probation: 0/2 정밀도 — 구조신호만으로 signpost↔relic 못 가름] "
                f"내용 검토 필요(삭제/relocate/유지는 사람 판정 — signpost일 수 있음)."))
    return out


def scan_gp2_dead_links(root: Path):
    """GP-2: 마크다운 ](상대경로) 타깃 부재. plans/·templates/ 는 whitelist(표시만).

    범위: draft 루트 .md *및* plugin/ 트리 .md (#011 F4 "GC 표면 확장" — plugin SKILL.md·
    README 의 상대링크까지). cycles/(역사적 생성물)·situational-rules/·.git 은 여전히 생략.
    __pycache__ 등 생성물 디렉토리는 스킵.
    """
    out = []
    for md in sorted(root.rglob("*.md")):
        rel_parts = md.relative_to(root).parts
        # 역사적 생성물·메타 트리는 GP-2 스캔 생략 (단 plugin 은 *포함* — #011 F4 확장)
        if rel_parts[0] in {"cycles", ".git", "situational-rules"}:
            continue
        if "__pycache__" in rel_parts:
            continue
        whitelisted = rel_parts[0] in LINK_WHITELIST_DIRS
        try:
            text = _strip_code(md.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, OSError):
            continue
        for m in _LINK_RE.finditer(text):
            target = m.group(1).strip()
            if target.startswith(("http://", "https://", "#", "mailto:")):
                continue
            path_part = target.split("#", 1)[0].strip()
            if not path_part:
                continue  # 순수 앵커
            resolved = (md.parent / path_part).resolve()
            if not resolved.exists():
                sev = "watch" if whitelisted else "high"
                note = f" ({rel_parts[0]}/ whitelist — 역사적/placeholder)" if whitelisted else ""
                out.append(Finding(
                    "GP-2", sev, str(md.relative_to(root)),
                    f"dead link → {target}{note}"))
    return out


def _func_exists(file: Path, func: str) -> bool:
    if not file.is_file():
        return False
    pat = re.compile(rf"^\s*def\s+{re.escape(func)}\s*\(", re.M)
    return bool(pat.search(file.read_text(encoding="utf-8")))


def scan_gp3_dup_parsers(root: Path):
    """GP-3: 선언 레지스트리 그룹별 멤버 수. 2=watch, ≥3=escalate(high)."""
    out = []
    for group, members in DUP_REGISTRY.items():
        present = [(f, fn) for f, fn in members if _func_exists(root / f, fn)]
        n = len(present)
        if n >= 3:
            out.append(Finding(
                "GP-3", "high", f"dup-group:{group}",
                f"멤버 {n}개 (≥3 = ESCALATE, R-CD04 Rule of Three 초과 → 공유 추출 필요): "
                + ", ".join(f"{f}::{fn}" for f, fn in present)))
        elif n == 2:
            out.append(Finding(
                "GP-3", "watch", f"dup-group:{group}",
                f"멤버 {n}개 (R-CD04상 watch, 통합 불요): "
                + ", ".join(f"{f}::{fn}" for f, fn in present)))
    return out


# GP-5 복잡도 카운트 대상 — plugin/harness/{scripts,hooks} 의 *프로덕션* 코드.
#  test-*.sh / __pycache__ / .pyc 는 제외(테스트·생성물은 메커니즘 수가 아님).
COMPLEXITY_DIRS = [f"{PLUGIN_HARNESS}/scripts", f"{PLUGIN_HARNESS}/hooks"]
COMPLEXITY_EXTS = {".py", ".sh"}


def count_complexity(root: Path):
    """GP-5: plugin/harness/{scripts,hooks} 의 프로덕션 스크립트+hook 수.

    test-*.sh(자가 테스트)·__pycache__·lib(ratchetlib/ruleslib 등 공유 lib 포함)을
    *전부* 센다 — '메커니즘 표면' 전체가 cold-context 재가동 비용이므로. 단 test 하니스는
    제외(메커니즘이 아니라 그 메커니즘의 *검증*). 반환: (총수, 파일목록).
    """
    files = []
    for d in COMPLEXITY_DIRS:
        dpath = root / d
        if not dpath.is_dir():
            continue
        for p in sorted(dpath.iterdir()):
            if not p.is_file() or p.suffix not in COMPLEXITY_EXTS:
                continue
            if p.name.startswith("test-"):
                continue  # 자가 테스트는 메커니즘 수에서 제외
            files.append(str(p.relative_to(root)))
    return len(files), files


def scan_gp5_complexity(root: Path):
    """GP-5: 아키텍처 복잡도를 *측정*해 watch 로 노출. 빼기 강제는 ratchet 축이 함.

    이 스캐너는 수를 *판정*하지 않는다(임계값 휴리스틱 = 추론 금지, #010 §2). 그냥 현재
    메커니즘 수를 리포트하고, ratchet 축(`harness-mechanism-count`, lower_better)으로 잠그라고
    상기시킨다 → 새 메커니즘 추가 사이클이 *은퇴 후보 없이* 수를 늘리면 close 게이트가 회귀로 차단.
    """
    n, files = count_complexity(root)
    if n == 0:
        return []
    return [Finding(
        "GP-5", "watch", "architecture:mechanism-count",
        f"프로덕션 스크립트+hook {n}개 (test 하니스 제외). ratchet 축 "
        f"`harness-mechanism-count`(lower_better)로 잠가 '빼기 없는 더하기'를 차단 — "
        f"메커니즘 추가 사이클은 은퇴 후보를 지명해야 close 통과(CA-11/PF-11).")]


# GP-4 의미적 stale — *결정론 불가*. 스캐너는 자동탐지 대신 mandatory 내용검토 체크리스트를 상기.
#  각 항목 = "이 문서가 *주장*하는 상태가 코드 현실과 일치하는가"를 사람/LLM 이 확인할 지점.
GP4_REVIEW_TARGETS = [
    ("hooks/README.md + plugin/harness/hooks/README.md",
     "'구현 상태'·'백로그' 섹션이 실제 구현된 hook 집합과 일치하는가 "
     "(#011 F2: '전부 미구현' 역방향 stale 전례 — 구현됐는데 '후보'로 남은 항목 점검)"),
    ("plugin/harness/skills/*/SKILL.md",
     "스킬이 안내하는 명령·플래그·로드 시점이 현재 스크립트 인터페이스와 일치하는가"),
    ("README.md · 13-operational-layer.md",
     "'N층 완성'·'X개 구현' 류 수치 주장이 현재 코드와 일치하는가 (PF-9: 검증≠설계 언어)"),
]


def gp4_review_reminders():
    """GP-4: 결정론적으로 못 잡는 의미적 stale — 사람 검토 체크리스트(자동탐지 아님)."""
    return [Finding("GP-4", "watch", "semantic-review:" + tgt, why)
            for tgt, why in GP4_REVIEW_TARGETS]


def scan_gp6_orphan_hooks(root: Path):
    """GP-6: hooks/ 에 존재하지만 hooks.json 에 미배선된 .py 파일 탐지 (결정론, high).

    배선 = hooks.json "command" 값에서 `/hooks/<name>.py` 패턴으로 파일명 추출.
    test-*.py 는 제외 (직접 배선 대상 아님).
    """
    hooks_dir = root / PLUGIN_HARNESS / "hooks"
    hooks_json_path = hooks_dir / "hooks.json"
    if not hooks_dir.is_dir() or not hooks_json_path.is_file():
        return []

    try:
        data = _json.loads(hooks_json_path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []

    wired: set = set()

    def _collect(obj):
        if isinstance(obj, dict):
            cmd = obj.get("command", "")
            if isinstance(cmd, str):
                m = re.search(r"/hooks/(\S+\.py)", cmd)
                if m:
                    wired.add(m.group(1))
            for v in obj.values():
                _collect(v)
        elif isinstance(obj, list):
            for item in obj:
                _collect(item)

    _collect(data)

    out = []
    for p in sorted(hooks_dir.iterdir()):
        if not p.is_file() or p.suffix != ".py":
            continue
        if p.name.startswith("test-"):
            continue
        if p.name not in wired:
            out.append(Finding(
                "GP-6", "high", str(p.relative_to(root)),
                "hooks/ 존재, hooks.json 미배선 — dead hook 또는 배선 누락 (orphan)"))
    return out


def scan_all(root: Path):
    return (scan_gp1_relic_dirs(root)
            + scan_gp2_dead_links(root)
            + scan_gp3_dup_parsers(root)
            + gp4_review_reminders()
            + scan_gp5_complexity(root)
            + scan_gp6_orphan_hooks(root))


def main():
    ap = argparse.ArgumentParser(description="하네스 표면 엔트로피 스캐너 (원칙6)")
    ap.add_argument("--root", default=str(DEFAULT_ROOT), help="스캔 루트 (기본: draft root)")
    ap.add_argument("--high-confidence-only", action="store_true",
                    help="HC 항목만; 남아있으면 exit 2 (fixpoint 게이트)")
    ap.add_argument("--complexity-axis", action="store_true",
                    help="GP-5 복잡도 수치 한 줄(ratchet 축 harness-mechanism-count 값)")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"ERROR: 스캔 루트가 디렉토리가 아님: {root}", file=sys.stderr)
        sys.exit(1)

    if args.complexity_axis:
        n, _ = count_complexity(root)
        print(n)
        sys.exit(0)
    findings = scan_all(root)
    high = [f for f in findings if f.severity == "high"]
    watch = [f for f in findings if f.severity == "watch"]

    if args.high_confidence_only:
        for f in high:
            print(f)
        if high:
            print(f"\nFAIL: high-confidence 엔트로피 {len(high)}건 잔존 (fixpoint 미도달)")
            sys.exit(2)
        print("OK: high-confidence 엔트로피 0 (fixpoint)")
        sys.exit(0)

    print(f"=== gc-scan: {root} ===")
    print(f"high-confidence: {len(high)} · watch: {len(watch)}\n")
    if high:
        print("## high-confidence (정리 대상)")
        for f in high:
            print(f"  {f}")
    if watch:
        print("\n## watch (advisory)")
        for f in watch:
            print(f"  {f}")
    if not findings:
        print("(엔트로피 없음 — clean)")
    sys.exit(0)


if __name__ == "__main__":
    main()
