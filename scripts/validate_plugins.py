#!/usr/bin/env python3
"""
Validates that all plugins in this repo are installable by Claude Code.

Checks:
  1. marketplace.json — valid JSON, required fields present
  2. Per plugin — source dir exists, plugin.json exists and is valid
  3. Per plugin — skills/ directory exists with at least one skill
  4. Per skill  — SKILL.md exists
  5. Per skill  — SKILL.md has valid YAML frontmatter with name + description
  6. Per skill  — description contains "Use when" (authoring rule)
  7. Per skill  — scenarios: field is present (required for trigger matching)
  8. Version consistency — plugin.json version matches marketplace.json
  9. Per skill  — SKILL.md line count warning if > 250 lines (HEAVY)
 10. Per skill  — compatibility: field present (MCP tool guidance)
 11. Per skill  — workflow skills have type: workflow field
 12. Per skill  — description length ≤ 250 chars (Claude Code truncation limit)
 13. Per skill  — heavy skills (>200 lines) should declare effort: field
 14. Per skill  — heavy skills (>200 lines) should have a Standing Mandates section

Authoring principles: skill/skills/skill-validator/references/authoring-principles.md
"""

import json
import os
import sys
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARKETPLACE = os.path.join(ROOT, ".claude-plugin", "marketplace.json")

errors = []
warnings = []


def err(msg):
    errors.append(f"  ERROR: {msg}")


def warn(msg):
    warnings.append(f"  WARN:  {msg}")


def parse_frontmatter(path):
    """Extract YAML frontmatter fields as a dict (simple key: value only)."""
    with open(path, encoding="utf-8") as f:
        content = f.read()

    if not content.startswith("---"):
        return {}

    end = content.find("\n---", 3)
    if end == -1:
        return {}

    front = content[3:end].strip()
    fields = {}
    current_key = None
    buffer = []

    for line in front.splitlines():
        key_match = re.match(r"^(\w[\w-]*):\s*(.*)", line)
        if key_match:
            if current_key and buffer:
                fields[current_key] = " ".join(buffer).strip()
            current_key = key_match.group(1)
            val = key_match.group(2).strip().strip("'\"").strip(">-").strip()
            buffer = [val] if val else []
        elif current_key and line.startswith("  "):
            buffer.append(line.strip().strip("'\""))

    if current_key and buffer:
        fields[current_key] = " ".join(buffer).strip()

    return fields


def check_marketplace():
    if not os.path.exists(MARKETPLACE):
        err(f"marketplace.json not found at {MARKETPLACE}")
        return None

    try:
        with open(MARKETPLACE) as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        err(f"marketplace.json is not valid JSON: {e}")
        return None

    for field in ("name", "owner", "plugins"):
        if field not in data:
            err(f"marketplace.json missing required field: '{field}'")

    print(f"  OK    marketplace.json ({len(data.get('plugins', []))} plugins)")
    return data


def check_plugin(plugin_entry):
    name = plugin_entry.get("name", "<unnamed>")
    source = plugin_entry.get("source", "")
    marketplace_version = plugin_entry.get("version", "")

    plugin_dir = os.path.normpath(os.path.join(ROOT, source))
    prefix = f"[{name}]"

    # 1. Source directory exists
    if not os.path.isdir(plugin_dir):
        err(f"{prefix} source directory not found: {plugin_dir}")
        return

    # 2. plugin.json exists and is valid
    plugin_json_path = os.path.join(plugin_dir, ".claude-plugin", "plugin.json")
    if not os.path.exists(plugin_json_path):
        err(f"{prefix} missing .claude-plugin/plugin.json")
        return

    try:
        with open(plugin_json_path) as f:
            plugin_data = json.load(f)
    except json.JSONDecodeError as e:
        err(f"{prefix} plugin.json is not valid JSON: {e}")
        return

    for field in ("name", "description", "version", "author", "category"):
        if field not in plugin_data:
            err(f"{prefix} plugin.json missing required field: '{field}'")

    # 3. Version consistency
    plugin_version = plugin_data.get("version", "")
    if marketplace_version and plugin_version and marketplace_version != plugin_version:
        warn(f"{prefix} version mismatch — marketplace.json: {marketplace_version}, plugin.json: {plugin_version}")

    # 4. skills/ directory
    skills_dir = os.path.join(plugin_dir, "skills")
    if not os.path.isdir(skills_dir):
        err(f"{prefix} missing skills/ directory")
        return

    skill_dirs = [
        d for d in os.listdir(skills_dir)
        if os.path.isdir(os.path.join(skills_dir, d))
    ]

    if not skill_dirs:
        err(f"{prefix} skills/ directory is empty")
        return

    skill_errors = []
    for skill_name in sorted(skill_dirs):
        skill_path = os.path.join(skills_dir, skill_name)
        skill_md = os.path.join(skill_path, "SKILL.md")

        # 5. SKILL.md exists
        if not os.path.exists(skill_md):
            skill_errors.append(f"    {skill_name}: SKILL.md not found")
            continue

        # 6. Frontmatter fields
        fm = parse_frontmatter(skill_md)

        if "name" not in fm:
            skill_errors.append(f"    {skill_name}: SKILL.md missing 'name' in frontmatter")

        if "description" not in fm:
            skill_errors.append(f"    {skill_name}: SKILL.md missing 'description' in frontmatter")
        else:
            desc = fm["description"].lower()
            trigger_patterns = ("use when", "use before", "use after", "apply when")
            if not any(p in desc for p in trigger_patterns):
                skill_errors.append(
                    f"    {skill_name}: description missing trigger pattern "
                    "(expected 'Use when', 'Use before', 'Use after', or 'Apply when')"
                )
            # 12. description length ≤ 250 chars (Claude Code truncation limit)
            if len(fm["description"]) > 250:
                warn(f"{prefix}/{skill_name}: description is {len(fm['description'])} chars "
                     f"(truncated at 250 in skill listing — front-load trigger keywords)")

        # 7. scenarios field
        if "scenarios" not in fm:
            skill_errors.append(f"    {skill_name}: SKILL.md missing 'scenarios' field")

        # 8. compatibility field
        if "compatibility" not in fm:
            skill_errors.append(f"    {skill_name}: SKILL.md missing 'compatibility' field (needed for MCP tool guidance)")

        # 9. line count — warn if heavy; read content for checks 13-14
        with open(skill_md, encoding="utf-8") as f:
            skill_content = f.read()
        line_count = skill_content.count("\n") + 1
        if line_count > 250:
            warn(f"{prefix}/{skill_name}: SKILL.md is {line_count} lines "
                 f"(HEAVY — split background content into references/; "
                 f"see authoring-principles.md)")

        # 13. heavy skills should declare effort field
        if line_count > 200 and "effort" not in fm:
            warn(f"{prefix}/{skill_name}: {line_count}-line skill has no 'effort' field "
                 f"(consider effort: high for judgment-heavy skills)")

        # 14. heavy skills should have a Standing Mandates section
        if line_count > 200:
            has_mandates = (
                "## Standing Mandates" in skill_content
                or "## Mandates" in skill_content
            )
            if not has_mandates:
                warn(f"{prefix}/{skill_name}: {line_count}-line skill has no '## Standing Mandates' section "
                     f"(discriminating behaviors should be front-loaded as standing instructions)")

        # 10. workflow skills must declare type: workflow
        if "workflow" in skill_name and fm.get("type", "") != "workflow":
            skill_errors.append(f"    {skill_name}: skill name contains 'workflow' but frontmatter missing 'type: workflow'")

    if skill_errors:
        for e in skill_errors:
            errors.append(e)
        print(f"  FAIL  {prefix} {len(skill_dirs)} skills, {len(skill_errors)} issue(s)")
    else:
        print(f"  OK    {prefix} {len(skill_dirs)} skills")


def main():
    print(f"\nValidating plugins in: {ROOT}\n")

    print("[ marketplace.json ]")
    marketplace = check_marketplace()
    if marketplace is None:
        print("\nAborting: cannot read marketplace.json\n")
        sys.exit(1)

    plugins = marketplace.get("plugins", [])
    print(f"\n[ plugins ({len(plugins)}) ]")
    for plugin in plugins:
        check_plugin(plugin)

    print()
    if warnings:
        print("Warnings:")
        for w in warnings:
            print(w)
        print()

    if errors:
        print(f"FAILED — {len(errors)} error(s) found:")
        for e in errors:
            print(e)
        print()
        sys.exit(1)
    else:
        print(f"PASSED — all {len(plugins)} plugins are installable")
        print()


if __name__ == "__main__":
    main()
