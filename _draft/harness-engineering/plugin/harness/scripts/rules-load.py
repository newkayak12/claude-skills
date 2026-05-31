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

HEADER_RE = re.compile(r"^##\s+(R-[A-Z0-9]+|[A-Z]+-\d+):\s*(.+)$")
STAGE_RE = re.compile(r"^\s*[*\-]?\s*\*{0,2}Stage\*{0,2}\s*:\s*(.+)$", re.IGNORECASE)


def parse_rules(text: str):
    rules = []
    current = None
    for line in text.splitlines():
        m = HEADER_RE.match(line)
        if m:
            if current:
                rules.append(current)
            current = {
                "id": m.group(1),
                "title": m.group(2),
                "stages": set(),
                "body": [line],
            }
            continue
        if current is None:
            continue
        sm = STAGE_RE.match(line)
        if sm:
            current["stages"].update(s.strip().lower() for s in sm.group(1).split(","))
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
    # body[0]은 header — 이미 출력했으므로 skip
    for line in r["body"][1:]:
        if STAGE_RE.match(line):
            continue
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
