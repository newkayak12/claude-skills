# skill:audit

## Plan

**Why.** "뭘 더 설치하면 좋아?" gets answered from memory today: plausible plugin names, none checked against what is
installed or what the catalog holds. Governing: `2026-09-30-skill-create.md`, `skill/skills/create/references/identity.md`
(P2 never supply a missing fact, P4 withhold the comfortable move, P6 boundary).

**What.**
1. New `skill/skills/audit/SKILL.md` (Standing Mandates first, hard cap 110 lines), read-only.
2. Inventory by name: repo, `.claude/settings*`, `.mcp.json`, CLAUDE.md/AGENTS.md, hooks, installed plugins.
3. Catalog = sources an installed skill can see: session skill list, `installed_plugins.json`,
   `~/.claude/plugins/marketplaces/*/.claude-plugin/marketplace.json` + READMEs; `_reference/external-skills.md`
   only if present, labeled "candidate, unverified". Else "no match". Every row cites a source path.
4. Output: verdict, three-way table, <=5 moves, hand-off (skill -> `skill:create`, hook -> `update-config`).
5. `skill/README.md` + `KOR.md`: three skills -> four.
- Out of scope: ECC-style parity framing, benchmarking official marketplaces, unranked "impact" lists, any write step.

## Done criteria

- [ ] SKILL.md <=110 lines; description starts `Use when`, <=250 chars; EN+KR scenarios; required sections in order.
- [ ] Secret rule covers `.env*`, `.mcp.json`, `.claude/settings*` (names only); dry run with a fake `.env` never prints the value.
- [ ] trigger-validator >=7 on borderline queries vs `harness:install`, `skill:create`, `write:writing-skills`.
- [ ] quality-assurance: no red items; `validate_plugins.py` no ERROR for `skill`.
- [ ] No version bump, no push.

## Critique

- **Overlap with `harness:install` / `skill:create`.** Description avoids install and creation phrases; `Not for` names both.
- **Memory recommendations.** The reflex the skill blocks. Guard: no source path, no row.
- **Secret leakage.** `.mcp.json` env blocks and tokenized URLs are as sensitive as `.env`; the rule names all three files.
- **Catalog visibility.** A repo-local `marketplace.json` is invisible in user projects, so the catalog reads installed
  marketplaces; `_reference/` is a bonus, not a dependency.
