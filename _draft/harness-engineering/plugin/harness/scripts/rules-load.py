#!/usr/bin/env python3
"""
rules-load.py — Filter rules from 06-rules.md by Stage tag.

각 룰은 06-rules.md에 `Stage: <name1>, <name2>` 메타데이터를 가진다.
현재 작업 단계에 *해당되는 룰만* 출력해 인지 부하를 줄인다.

Usage:
  rules-load.py <stage>          # 해당 stage 룰만 출력
  rules-load.py --list-stages    # 사용 가능한 stage 목록 + 룰 개수
  rules-load.py --all            # 모든 룰

`always` 태그가 붙은 룰은 어떤 stage에서도 함께 출력.
"""
import argparse
import re
import sys
from pathlib import Path

RULES_FILE = Path(__file__).resolve().parent.parent / "06-rules.md"

# 06-rules.md 실제 구조: H2 섹션(`## N. 제목`) 아래 `**로딩 시점**: `stageA`, `stageB``,
# 그 섹션의 H3 룰(`### R-XX: 제목`)들이 섹션 stage를 *상속*한다. per-rule Stage 태그는 없다.
SECTION_RE = re.compile(r"^##\s+\S")                       # 모든 H2 → 섹션 경계(stage 리셋)
LOAD_RE = re.compile(r"^\s*\*\*로딩 시점\*\*\s*:\s*(.+)$")    # 섹션 stage 선언
RULE_RE = re.compile(r"^###\s+([A-Za-z][\w-]*):\s*(.+)$")  # H3 룰 헤더
_BACKTICK = re.compile(r"`([^`]+)`")


def parse_rules(text: str):
    """섹션 단위 `로딩 시점`을 그 섹션의 H3 룰들에 상속시켜 파싱."""
    rules = []
    current = None
    section_stages: set[str] = set()
    for line in text.splitlines():
        rm = RULE_RE.match(line)
        if rm:
            if current:
                rules.append(current)
            current = {
                "id": rm.group(1),
                "title": rm.group(2),
                "stages": set(section_stages),  # 섹션 stage 상속
                "body": [line],
            }
            continue
        if SECTION_RE.match(line):
            # 새 H2 섹션 진입 — 직전 룰 마감 + stage 리셋(다음 로딩시점 줄까지 비움)
            if current:
                rules.append(current)
                current = None
            section_stages = set()
            continue
        lm = LOAD_RE.match(line)
        if lm:
            stages = {t.strip().lower() for t in _BACKTICK.findall(lm.group(1))}
            section_stages = stages
            continue
        if current is not None:
            current["body"].append(line)
    if current:
        rules.append(current)
    return rules


def load_rules():
    if not RULES_FILE.exists():
        print(f"ERROR: rules file not found: {RULES_FILE}", file=sys.stderr)
        sys.exit(1)
    return parse_rules(RULES_FILE.read_text(encoding="utf-8"))


def print_rule(r):
    print(f"## {r['id']}: {r['title']}")
    if r["stages"]:
        print(f"_Stages: {', '.join(sorted(r['stages']))}_")
    print()
    # body[0]은 header — 이미 출력했으므로 skip. stage는 섹션 단위라 body에 없음.
    for line in r["body"][1:]:
        print(line)
    print()


def cmd_filter(stage: str):
    rules = load_rules()
    target = stage.lower()
    matched = [r for r in rules if target in r["stages"] or "always" in r["stages"]]
    if not matched:
        print(f"(no rules tagged with Stage: {target})")
        print()
        print("Available stages — `rules-load.py --list-stages`")
        return
    print(f"# Rules for stage: {stage}")
    print(f"({len(matched)} rules matched — including 'always')")
    print()
    for r in matched:
        print_rule(r)


def cmd_list_stages():
    rules = load_rules()
    counts = {}
    for r in rules:
        for s in r["stages"]:
            counts[s] = counts.get(s, 0) + 1
    if not counts:
        print("(no Stage tags found in 06-rules.md)")
        return
    print("Available stages:")
    for s in sorted(counts.keys()):
        print(f"  {s:<20} ({counts[s]} rules)")


def cmd_all():
    rules = load_rules()
    print(f"# All rules ({len(rules)})")
    print()
    for r in rules:
        print_rule(r)


def main():
    parser = argparse.ArgumentParser(description="Filter rules by Stage tag")
    parser.add_argument("stage", nargs="?", help="Stage name to filter by")
    parser.add_argument("--list-stages", action="store_true")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    if args.list_stages:
        cmd_list_stages()
    elif args.all:
        cmd_all()
    elif args.stage:
        cmd_filter(args.stage)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
