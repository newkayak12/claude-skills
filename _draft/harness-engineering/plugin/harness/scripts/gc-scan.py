#!/usr/bin/env python3
"""gc-scan.py — 하네스 자신의 표면 엔트로피 스캐너 (원칙6).

GOLDEN-PRINCIPLES.md 의 각 GP-id 를 1:1 로 검사한다 (선언이지 추론 아님 — #010 §2).
  GP-1  relic 코드 디렉토리 (README 만 남고 코드는 plugin/harness 로 이전)  [watch]
  GP-2  죽은 네비게이션 링크 (](상대경로) 타깃 부재)                        [high]
  GP-3  중복 파서 Rule-of-Three watch (선언 레지스트리, 2=watch ≥3=escalate) [watch]

사용:
  gc-scan.py                       # 전체 리포트 (exit 0)
  gc-scan.py --high-confidence-only # HC 항목만; 남아있으면 exit 2 (fixpoint 게이트/B4)
  gc-scan.py --root <dir>          # 스캔 루트 override (hermetic 테스트용)
"""
import argparse
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
                f"내용 검토 필요(삭제/relocate/유지는 사람 판정 — signpost일 수 있음)."))
    return out


def scan_gp2_dead_links(root: Path):
    """GP-2: 마크다운 ](상대경로) 타깃 부재. plans/ 는 whitelist(표시만)."""
    out = []
    for md in sorted(root.rglob("*.md")):
        rel_parts = md.relative_to(root).parts
        if rel_parts[0] in SKIP_TOP_DIRS and rel_parts[0] != "templates":
            # plugin/cycles/situational-rules/.git 내부 .md 는 GP-2 스캔 생략 (생성물·본체)
            if rel_parts[0] in {"plugin", "cycles", ".git", "situational-rules"}:
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


def scan_all(root: Path):
    return (scan_gp1_relic_dirs(root)
            + scan_gp2_dead_links(root)
            + scan_gp3_dup_parsers(root))


def main():
    ap = argparse.ArgumentParser(description="하네스 표면 엔트로피 스캐너 (원칙6)")
    ap.add_argument("--root", default=str(DEFAULT_ROOT), help="스캔 루트 (기본: draft root)")
    ap.add_argument("--high-confidence-only", action="store_true",
                    help="HC 항목만; 남아있으면 exit 2 (fixpoint 게이트)")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"ERROR: 스캔 루트가 디렉토리가 아님: {root}", file=sys.stderr)
        sys.exit(1)
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
