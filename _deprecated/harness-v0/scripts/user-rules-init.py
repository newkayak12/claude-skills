#!/usr/bin/env python3
"""
user-rules-init.py — Generate / extend the L1 user-rules file (`~/.harness/user-rules.md`).

GOAL §2 step 3 / §3.2: 첫 실행 시 사용자와 *대화로* L1 user-rules를 만든다.
`harness:install` 스킬이 사용자 답변을 모아 이 스크립트를 호출한다 — 수동 파일 작성이 *기본 경로*가 아니다.
포맷은 `12-rule-layering.md §3`의 룰 frontmatter (id/scope/layer/stage/pointer)를 따른다.

멱등(AP-30 / 데이터 파괴 방지):
  - 파일이 없으면 헤더 + 룰 생성.
  - 있으면 *덮어쓰지 않는다*. `--add`로 룰을 append (중복 id는 거부),
    전체 재생성은 `--force`(기존을 .bak로 백업 후) 일 때만.

Usage:
  user-rules-init.py init [--lang L] [--pointer-python P] ...   # 최초 생성
  user-rules-init.py add  --id R-USER-XX --layer L1 --scope default \
      --title "..." [--pointer FILE] [--why "..."]              # 룰 1개 추가
  user-rules-init.py show                                       # 현재 파일 출력
  user-rules-init.py path                                       # 파일 경로 출력

환경:
  HARNESS_HOME (기본 ~/.harness) — 테스트는 이 변수로 hermetic 격리.
"""
import argparse
import os
import re
import shutil
import sys
from datetime import date
from pathlib import Path


def harness_home() -> Path:
    return Path(os.environ.get("HARNESS_HOME", str(Path.home() / ".harness")))


def rules_file() -> Path:
    return harness_home() / "user-rules.md"


HEADER = """# L1 User Rules

> 이 사용자의 *모든 프로젝트*에 적용되는 룰 (L1). 우선순위: `L3 > L2 > L1 > L0 Default`.
> `L0 Core (invariant)`는 override 불가. 포맷: harness 플러그인의 `12-rule-layering.md §3` 참고.
> 코드 스타일은 *내용*을 적지 말고 `Pointer:` 설정 파일 경로만 (§5, AP-29).
>
> 생성: harness:install / user-rules-init.py — 직접 편집보다 `user-rules-init.py add` 권장.

생성일: {created}
"""

# Stage 는 L0(06-rules.md §0.1) 어휘를 쓴다 — 그래야 rules-merge 가 L0+L1 을 *같은 stage 로*
# 필터·머지한다. `*` = 모든 stage(wildcard). (12-layering §3 의 Macro/Micro 어휘는 L0 와
# 불일치해 stage-filtered load 에서 룰이 죽음 — #010 리뷰 F1.)
RULE_TMPL = """## {id}: {title}
Layer: {layer}
Scope: {scope}
Stage: {stage}
{pointer_line}{overrides_line}Why: {why}
"""

ID_RE = re.compile(r"^##\s+(R-[A-Z0-9-]+):", re.MULTILINE)


def _rule_block(rid, title, layer, scope, stage, pointer, why, overrides=None) -> str:
    pointer_line = f"Pointer: {pointer}\n" if pointer else ""
    overrides_line = f"Overrides: {overrides}\n" if overrides else ""
    return RULE_TMPL.format(
        id=rid, title=title, layer=layer, scope=scope, stage=stage,
        pointer_line=pointer_line, overrides_line=overrides_line, why=why,
    )


def existing_ids(text: str) -> set[str]:
    return set(ID_RE.findall(text))


def cmd_init(args) -> None:
    rf = rules_file()
    if rf.exists() and not args.force:
        print(
            f"이미 존재: {rf}\n"
            f"  덮어쓰지 않습니다(멱등). 룰 추가는 `add`, 전체 재생성은 `--force`(.bak 백업됨).",
            file=sys.stderr,
        )
        sys.exit(2)
    if rf.exists() and args.force:
        bak = rf.with_suffix(".md.bak")
        shutil.copy2(rf, bak)
        print(f"기존 백업 → {bak}")

    rf.parent.mkdir(parents=True, exist_ok=True)
    parts = [HEADER.format(created=date.today().isoformat())]

    # 대화에서 모은 흔한 기본값들 → 룰로. 모두 선택적.
    if args.lang:
        parts.append(_rule_block(
            "R-USER-LANG01", f"선호 언어/스택: {args.lang}", "L1", "default", "*",
            None, "프로젝트 기본 스택. L2에서 override 가능."))
    if args.pointer_python:
        parts.append(_rule_block(
            "R-USER-FMT-PY", "Python 포맷터/린터", "L1", "default", "code-writing",
            args.pointer_python, "스타일 enforcement는 toolchain. 하네스는 설정 존재만 검증(§5)."))
    if args.pointer_js:
        parts.append(_rule_block(
            "R-USER-FMT-JS", "JS/TS 포맷터/린터", "L1", "default", "code-writing",
            args.pointer_js, "스타일 enforcement는 toolchain. 하네스는 설정 존재만 검증(§5)."))
    if args.pointer_kotlin:
        parts.append(_rule_block(
            "R-USER-FMT-KT", "Kotlin 린터/정적분석", "L1", "default", "code-writing",
            args.pointer_kotlin, "스타일 enforcement는 toolchain. 하네스는 설정 존재만 검증(§5)."))
    if args.pointer_java:
        parts.append(_rule_block(
            "R-USER-FMT-JV", "Java 린터/정적분석", "L1", "default", "code-writing",
            args.pointer_java, "스타일 enforcement는 toolchain. 하네스는 설정 존재만 검증(§5)."))
    for name, path in (args.pointer or []):
        slug = re.sub(r"[^A-Z0-9]", "", name.upper()) or "X"
        rid = f"R-USER-FMT-{slug}"
        parts.append(_rule_block(
            rid, f"{name} 포맷터/린터", "L1", "default", "code-writing",
            path, "스타일 enforcement는 toolchain. 하네스는 설정 존재만 검증(§5)."))
    if args.wip:
        # WIP=1 은 스펙(12-layering §1)상 L0 Default 라지만 06-rules.md 에 *룰로 코드화돼 있지
        # 않다* → override 대상이 없다. 따라서 이건 additive L1 선언(거짓 Overrides 금지).
        # 사이클별 일시 변경은 L3 exemption.
        parts.append(_rule_block(
            "R-USER-WIP01", f"기본 WIP: {args.wip}", "L1", "default", "*",
            None, "사용자 기본 WIP 선언 (additive — L0엔 WIP가 룰로 코드화돼 있지 않아 override 대상 없음). 사이클별 변경은 L3."))

    rf.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")
    print(f"GENERATED → {rf}")
    print(f"  룰 {len(parts)-1}개 (헤더 제외). 추가: user-rules-init.py add ...")


def cmd_add(args) -> None:
    rf = rules_file()
    if not rf.exists():
        print(f"파일 없음: {rf} — 먼저 `init` 하세요.", file=sys.stderr)
        sys.exit(2)
    text = rf.read_text(encoding="utf-8")
    if args.id in existing_ids(text):
        print(f"중복 id 거부: {args.id} 이미 존재 (멱등 — 데이터 파괴 방지).", file=sys.stderr)
        sys.exit(2)
    block = _rule_block(args.id, args.title, args.layer, args.scope, args.stage,
                        args.pointer, args.why or "")
    with rf.open("a", encoding="utf-8") as fh:
        fh.write("\n" + block)
    print(f"ADDED {args.id} → {rf}")


def cmd_show(_args) -> None:
    rf = rules_file()
    if not rf.exists():
        print(f"(없음: {rf})")
        return
    sys.stdout.write(rf.read_text(encoding="utf-8"))


def cmd_path(_args) -> None:
    print(rules_file())


def main() -> None:
    ap = argparse.ArgumentParser(description="L1 user-rules 생성/확장 (멱등)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="최초 생성")
    p_init.add_argument("--lang", help="선호 언어/스택 (예: 'Python 3.12 / FastAPI')")
    p_init.add_argument("--pointer-python", help="Python 포맷터 설정 파일 (예: pyproject.toml)")
    p_init.add_argument("--pointer-js", help="JS/TS 포맷터 설정 파일 (예: biome.json)")
    p_init.add_argument("--pointer-kotlin", help="Kotlin 정적분석 설정 파일 (예: detekt.yml)")
    p_init.add_argument("--pointer-java", help="Java 정적분석 설정 파일 (예: checkstyle.xml)")
    p_init.add_argument(
        "--pointer", nargs=2, action="append", metavar=("NAME", "PATH"),
        help="범용 포인터: <언어/툴 이름> <설정파일 경로> (반복 가능, 예: --pointer go .golangci.yml)")
    p_init.add_argument("--wip", help="기본 WIP override (예: 1)")
    p_init.add_argument("--force", action="store_true", help="기존을 .bak 백업 후 재생성")
    p_init.set_defaults(func=cmd_init)

    p_add = sub.add_parser("add", help="룰 1개 추가 (중복 id 거부)")
    p_add.add_argument("--id", required=True)
    p_add.add_argument("--title", required=True)
    p_add.add_argument("--layer", default="L1")
    p_add.add_argument("--scope", default="default", choices=["invariant", "default"])
    p_add.add_argument("--stage", default="*")
    p_add.add_argument("--pointer")
    p_add.add_argument("--why")
    p_add.set_defaults(func=cmd_add)

    sub.add_parser("show", help="현재 파일 출력").set_defaults(func=cmd_show)
    sub.add_parser("path", help="파일 경로 출력").set_defaults(func=cmd_path)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
