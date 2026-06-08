#!/usr/bin/env python3
"""
project-install.py — 하네스를 *대상 프로젝트의 `.claude/`로 vendoring* 설치한다 (delivery 재설계, P0).

왜 (delivery 모델 실패의 교정):
  기존 전달은 전역 마켓플레이스 플러그인 + 사용자-전역 `~/.harness/user-rules.md` + *명시적*
  `harness:cycle` 호출에 갇혀 있었다 → (1) per-project 타겟팅 불가(전역 한 버전), (2) "그냥 쓰면
  그 레포에선 자동으로 하네스 아래서 AI 동작"이 안 됨. 올바른 모델(revfactory/harness 패턴 + 이
  레포 자신이 그렇게 동작): 설치물을 프로젝트 `.claude/`에 *써넣어* `.claude/` 자동로드로
  per-project + ambient governance를 동시에 얻는다.

무엇을:
  1. 하네스 self-contained 페이로드를 `<proj>/.claude/harness/`로 vendoring.
     → *자기가 사는 평탄화 플러그인 페이로드*(설치된 글로벌 `harness/`)를 **직접 재귀복사**한다.
        harness-export 에 의존하지 않는다 — harness-export 는 _draft 전용 빌드도구라 글로벌
        플러그인엔 없다(#014 F5: subprocess 의존이 프로덕션 install을 file-not-found로 깨뜨림).
        설치기 자신은 *이미 평탄화된* 빌드 산출물 안에서 동작하므로 재귀복사면 충분하다.
     → 레포에 커밋되어 따라다니는 *고정 버전*. 전역 플러그인 갱신과 무관.
  2. `<proj>/.claude/settings.json` 의 hooks 블록 생성/병합 — 페이로드 hooks.json 의
     `${CLAUDE_PLUGIN_ROOT}` 를 `$CLAUDE_PROJECT_DIR/.claude/harness` 로 치환.
     → 그 레포에서 hook이 자동 발화. (벤더링 hook은 CLAUDE_PLUGIN_ROOT 없이 상대 fallback으로
        형제 script를 자급 해석 — 기존 설계가 이미 받쳐줌.)
  3. `<proj>/.claude/CLAUDE.md` 에 하네스 사이클 규율 계약을 marker 블록으로 scaffold.
     → AI가 의식 없이 그 프로젝트에서 사이클 규율 아래 동작(ambient).

멱등 + 버전 인식 (update UX):
  - 페이로드는 `.harness-vendored` 마커로 안전 재빌드(마커 없는 비어있지-않은 dest 는 거부).
  - 마커에 *벤더링한 버전*을 박아, 재실행 시 소스 버전과 비교해 `신규 설치`/`이미 최신`/
    `업그레이드 vX→vY` 를 *보고*한다 — 거부가 아니라 정보성. marketplace update 후 이 스크립트
    재실행이 새 버전을 프로젝트로 당기는 *유일* 경로(벤더링=고정복사본이라 전역 갱신은 안 닿음).
  - settings.json hooks 는 command 문자열 기준 dedup(재실행해도 중복 추가 0, 사용자 hook 보존).
  - CLAUDE.md 는 `<!-- harness:* -->` 마커 블록만 교체(나머지 사용자 내용 보존).

Usage:
  project-install.py --project <dir> [--from <built-harness>] [--dry-run]
    --from 미지정 시 *설치기 자신*의 페이로드 루트(= 글로벌 플러그인 `harness/`)에서 복사.
    --from 은 빌드된 `harness/`(프로덕션 설치 레이아웃)에서 벤더링하는 테스트/검증용.
"""
import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).resolve()
# 설치기는 *평탄화된* 플러그인 페이로드 안에 산다: <payload>/scripts/project-install.py
# → parents[1] 이 페이로드 루트(프로덕션: 글로벌 `harness/`; 거기에 06-rules.md 등이 평탄화돼 있음).
DEFAULT_SOURCE = _HERE.parents[1]

PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}"
PROJECT_HARNESS = "$CLAUDE_PROJECT_DIR/.claude/harness"   # 벤더링 위치(프로젝트 기준)

CLAUDE_MD_BEGIN = "<!-- harness:begin -->"
CLAUDE_MD_END = "<!-- harness:end -->"

VENDOR_MARKER = ".harness-vendored"   # dest 가 우리 산출물임을 표시 (멱등 안전)

# 벤더링 페이로드에서 뺀다 — build/maintainer/installer 도구는 *대상 프로젝트 런타임*에 무의미.
# (gc-scan/harness-export 는 글로벌 플러그인 export 에서 이미 빠지지만 방어적으로 한 번 더,
#  project-install 자신은 대상 프로젝트가 또 설치할 일이 없으니 뺀다.)
PAYLOAD_EXCLUDE = {
    "__pycache__", ".harness-export",
    "harness-export.py", "test-harness-export.sh",
    "gc-scan.py", "test-gc-scan.sh",
    "project-install.py", "test-project-install.sh",
}


def _ignore(_dir, names):
    return [n for n in names if n in PAYLOAD_EXCLUDE or n.endswith(".pyc")]


def _governance_block() -> str:
    """CLAUDE.md 에 박을 ambient governance 계약 (marker 사이)."""
    return (
        f"{CLAUDE_MD_BEGIN}\n"
        "## 이 프로젝트는 harness 사이클 규율 아래서 작업한다\n\n"
        "`.claude/harness/` 가 설치돼 있다. 기본 계약 —\n\n"
        "- **작업 = 사이클.** 새 기능·구조 변경은 사이클로 연다: `python3 .claude/harness/scripts/cycle-init.py \"<name>\" --type dev-tool`. "
        "이후 절차·register 스크립트는 `harness:cycle` 스킬이 운반.\n"
        "- **WIP=1.** 열린 사이클은 하나. 새로 열기 전에 진행 중인 것을 닫는다.\n"
        "- **게이트.** 가설/품질-바를 *먼저* 잠그고 → 독립 리뷰어(doer≠reviewer)가 채점 → 게이트로 닫는다. "
        "cross-cycle ratchet 이 사이클을 넘어 바가 낮아지는 걸 막는다.\n"
        "- **plan-before-code.** 코드는 phase 가 implementation/validation 일 때만. PreToolUse phase-guard 가 "
        "자동 강제(미충족 시 편집 차단); 전진은 `phase-advance.py`(절차는 `harness:cycle`).\n\n"
        "> 단순 버그픽스·유지보수는 사이클을 강제하지 않는다(GOAL: 솔로 dev 제품 *한 사이클*).\n"
        f"{CLAUDE_MD_END}"
    )


def _check_source(source: Path) -> None:
    """소스가 평탄화된 self-contained 페이로드인지 검증. 아니면 즉시 거부."""
    problems = []
    if not (source / "06-rules.md").exists():
        problems.append(
            "06-rules.md 없음 — 평탄화된 self-contained 페이로드가 아님. "
            "빌드된 `harness/`(harness-export 산출물)를 --from 으로 지정하거나, "
            "설치기를 글로벌 플러그인(`harness/scripts/`)에서 실행하세요."
        )
    for d in ("skills", "hooks", "scripts", ".claude-plugin"):
        if not (source / d).is_dir():
            problems.append(f"필수 디렉토리 없음: {source / d}")
    if not (source / "hooks" / "hooks.json").exists():
        problems.append(f"hooks.json 없음: {source / 'hooks' / 'hooks.json'}")
    if problems:
        print(f"🛑 소스 페이로드 검증 실패: {source}", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        sys.exit(1)


def _safe_dest(dest: Path) -> bool:
    if not dest.exists():
        return True
    if (dest / VENDOR_MARKER).exists():
        return True
    return not any(dest.iterdir())


def _read_source_version(source: Path) -> str:
    try:
        return json.loads(
            (source / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        ).get("version", "?")
    except Exception:
        return "?"


def _read_vendored_version(dest: Path):
    """기존 벤더 마커의 버전. 없거나 구형 plain-text 마커면 None(=버전 미상)."""
    marker = dest / VENDOR_MARKER
    if not marker.exists():
        return None
    try:
        return json.loads(marker.read_text(encoding="utf-8")).get("version")
    except Exception:
        return None


def _upgrade_label(old_ver, src_ver: str, existed: bool) -> str:
    if not existed:
        return f"신규 설치 v{src_ver}"
    if old_ver == src_ver:
        return f"이미 최신 v{src_ver} (재-벤더 새로고침)"
    if old_ver is None:
        return f"이전(버전 미상) → v{src_ver} 재-벤더"
    return f"업그레이드 v{old_ver} → v{src_ver}"


def _vendor_payload(claude_dir: Path, source: Path, dry: bool) -> Path:
    """평탄화 페이로드(source)를 <proj>/.claude/harness 로 *직접 재귀복사* (버전 인식)."""
    dest = claude_dir / "harness"
    src_ver = _read_source_version(source)
    existed = dest.exists()
    label = _upgrade_label(_read_vendored_version(dest), src_ver, existed)
    if dry:
        print(f"  [dry] vendor payload — {label}: {source} → {dest}")
        return dest
    if not _safe_dest(dest):
        print(
            f"🛑 벤더링 거부 — dest 가 비어있지 않고 vendored 산출물도 아님(마커 {VENDOR_MARKER} 없음): {dest}\n"
            f"   임의 디렉토리 삭제 방지. 의도된 재설치면 비우고 다시 실행.",
            file=sys.stderr,
        )
        sys.exit(1)
    if existed:
        shutil.rmtree(dest)
    shutil.copytree(source, dest, ignore=_ignore)
    (dest / VENDOR_MARKER).write_text(
        json.dumps({
            "version": src_ver,
            "vendored_at": datetime.now(timezone.utc).isoformat(),
            "note": "VENDORED by project-install.py (평탄화 페이로드 직접복사). 직접 편집 금지.",
        }, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"  ✓ payload vendored — {label} → {dest}")
    return dest


def _load_hooks_json(payload_or_source: Path) -> dict:
    hj = payload_or_source / "hooks" / "hooks.json"
    if not hj.exists():
        print(f"🛑 hooks.json 없음: {hj}", file=sys.stderr)
        sys.exit(1)
    return json.loads(hj.read_text(encoding="utf-8")).get("hooks", {})


def _translate(hooks: dict) -> dict:
    """command 의 ${CLAUDE_PLUGIN_ROOT} → $CLAUDE_PROJECT_DIR/.claude/harness."""
    out = {}
    for event, blocks in hooks.items():
        new_blocks = []
        for block in blocks:
            nb = {k: v for k, v in block.items() if k != "hooks"}
            nb["hooks"] = [
                {**h, "command": h["command"].replace(PLUGIN_ROOT_VAR, PROJECT_HARNESS)}
                for h in block.get("hooks", [])
            ]
            new_blocks.append(nb)
        out[event] = new_blocks
    return out


def _merge_hooks(settings: dict, harness_hooks: dict) -> int:
    """harness hooks 를 settings 에 병합 — command 기준 dedup(멱등, 사용자 hook 보존). 추가된 command 수 반환."""
    hooks = settings.setdefault("hooks", {})
    added = 0
    for event, blocks in harness_hooks.items():
        existing_blocks = hooks.setdefault(event, [])
        existing_cmds = {h.get("command") for b in existing_blocks for h in b.get("hooks", [])}
        for block in blocks:
            fresh = [h for h in block["hooks"] if h.get("command") not in existing_cmds]
            if not fresh:
                continue
            nb = {k: v for k, v in block.items() if k != "hooks"}
            nb["hooks"] = fresh
            existing_blocks.append(nb)
            added += len(fresh)
    return added


def _write_settings(claude_dir: Path, harness_hooks: dict, dry: bool) -> None:
    path = claude_dir / "settings.json"
    settings = {}
    if path.exists():
        try:
            settings = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"🛑 기존 settings.json 파싱 실패 — 덮어쓰지 않음: {path}", file=sys.stderr)
            sys.exit(1)
    added = _merge_hooks(settings, harness_hooks)
    if dry:
        print(f"  [dry] settings.json hooks 병합 → +{added} command (멱등 dedup)")
        return
    path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  ✓ settings.json hooks 병합 (+{added} command{', 이미 최신' if added == 0 else ''})")


def _write_claude_md(claude_dir: Path, dry: bool) -> None:
    path = claude_dir / "CLAUDE.md"
    block = _governance_block()
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if CLAUDE_MD_BEGIN in existing and CLAUDE_MD_END in existing:
        pre = existing.split(CLAUDE_MD_BEGIN)[0]
        post = existing.split(CLAUDE_MD_END, 1)[1]
        new = pre + block + post
        action = "governance 블록 교체(멱등)"
    elif existing.strip():
        new = existing.rstrip() + "\n\n" + block + "\n"
        action = "governance 블록 추가(기존 CLAUDE.md 보존)"
    else:
        new = "# Project — Claude Instructions\n\n" + block + "\n"
        action = "CLAUDE.md 신규 생성"
    if dry:
        print(f"  [dry] CLAUDE.md — {action}")
        return
    path.write_text(new, encoding="utf-8")
    print(f"  ✓ CLAUDE.md — {action}")


def main() -> None:
    ap = argparse.ArgumentParser(description="하네스를 프로젝트 .claude/ 로 vendoring 설치 (P0 delivery)")
    ap.add_argument("--project", required=True, type=Path, help="대상 프로젝트 루트")
    ap.add_argument("--from", dest="source", type=Path, default=DEFAULT_SOURCE,
                    help="복사할 평탄화 페이로드 루트 (기본: 설치기 자신의 페이로드 = 글로벌 harness/)")
    ap.add_argument("--dry-run", action="store_true", help="쓰지 않고 계획만 출력")
    args = ap.parse_args()

    proj = args.project.resolve()
    if not proj.is_dir():
        print(f"🛑 프로젝트 디렉토리 아님: {proj}", file=sys.stderr)
        sys.exit(1)

    source = args.source.resolve()
    _check_source(source)

    claude_dir = proj / ".claude"
    if not args.dry_run:
        claude_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== harness project-install → {proj} {'(dry-run)' if args.dry_run else ''} ===")
    print(f"  source(평탄화 페이로드): {source}")
    _vendor_payload(claude_dir, source, args.dry_run)
    # hooks 는 source 에서 직접 읽어 치환(설치 결과와 동형) — dry/실설치 동일 경로.
    harness_hooks = _translate(_load_hooks_json(source))
    _write_settings(claude_dir, harness_hooks, args.dry_run)
    _write_claude_md(claude_dir, args.dry_run)

    print()
    print(f"완료 — '{proj.name}' 는 이제 harness 아래서 동작합니다 (.claude/ 자동로드).")
    print("  다음: 이 프로젝트에서 세션을 열면 SessionStart hook이 룰을 주입하고,")
    print("        `python3 .claude/harness/scripts/cycle-init.py \"<name>\" --type dev-tool` 로 첫 사이클을 엽니다.")


if __name__ == "__main__":
    main()
