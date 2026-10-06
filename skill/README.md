# skill

**English** · [한국어](KOR.md)

Four skills for making and checking skills. `create` writes a new skill that carries the
repo's house identity. Then a SKILL.md can still fail in two independent ways: it never fires
because its `description` gives Claude no signal, or it fires and then doesn't earn its place —
too heavy, badly structured, or no better than no skill at all. `trigger-validator` measures
and fixes the first; `quality-assurance` runs the six checks that cover the second, ending
in a prioritized fix list. `audit` comes before all three: it checks what the workspace already
has before anything new is installed or built.

## Install & Uninstall

```bash
/plugin install skill@newkayak12-claude-skills
/plugin uninstall skill@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Turn "I need a skill for X" into a SKILL.md that matches the repo's existing skills | `create` |
| Review a skill before shipping and get a ranked list of what to fix | `quality-assurance` |
| Fix a skill that doesn't fire on natural language, especially Korean | `trigger-validator` |
| See what this workspace already has and what is missing, before installing or building | `audit` |

## Skills

### `create`

Writes a new skill that reads like one the repo owner wrote. The shape matters least: `create`
works from `references/identity.md`, thirteen principles induced from ~30 skills plus the owner's
coding guidelines — re-checkable output, never inventing a missing fact, the actor never grading
itself, one forbidden comfortable reflex, a stated boundary, the user deciding, minimum and surgical.
Before drafting it reads identity.md and 3–4 real skills and writes three anchor lines: the reflex
the skill forbids, its `Not for` boundary, and what "done" means. It audits the draft against all
thirteen principles, runs the repo validator, then hands off to `trigger-validator` and
`quality-assurance`. `write:writing-skills` stays the discipline for editing and repairing.

```
Create a skill that checks commit messages against our convention. Look at how the
other skills in this repo are laid out first.
```

### `quality-assurance`

Runs six quality checks on a skill and produces an actionable report. It reads every file in the
skill directory — `SKILL.md`, `agents/`, `references/`, `scripts/` — noting absent directories
rather than skipping the check, then dispatches checks 1–5 in parallel and check 6 after, since
output quality depends on knowing what the skill promised. It is the gate before publishing and
also useful mid-creation.

```
Review skill/skills/trigger-validator before I ship it. Six checks, and tell me
what to fix first.
```

| # | Check | Agent | Verdict scale |
|---|---|---|---|
| 1 | Usefulness | `agents/usefulness-checker.md` | PASS / WARN / FAIL |
| 2 | Authoring principles (incl. required sections, length) | `agents/authoring-checker.md` | PASS / WARN / FAIL |
| 3 | Agent structure | `agents/structure-reviewer.md` | GOOD / IMPROVABLE / MISSING |
| 4 | MCP fit | `agents/mcp-advisor.md` | NONE / OPTIONAL / RECOMMENDED |
| 5 | SKILL.md weight | `agents/weight-analyzer.md` | LIGHT / OK / HEAVY / CRITICAL |
| 6 | Output quality | `agents/eval-agent.md` | PASS / MARGINAL / FAIL |

Check 6 measures with-skill against a no-skill baseline and reports both pass rates plus the
delta, the discriminating assertions the skill enforces, and the gaps it promises but doesn't
deliver. The report closes with **Top Improvements** — 🔴 must fix / 🟡 recommended / 🟢 optional —
written concretely enough to act on directly.

### `trigger-validator`

Audits the `description` field, the only signal Claude uses when deciding whether to invoke a
skill, and rewrites it as a drop-in replacement. Point it at a single skill, a whole plugin, or
the entire repo; if no target is given it asks first. It touches only the frontmatter
`description`, never the body, and asks before applying unless you already asked for the fix.

```
develop 플러그인 스킬들 트리거 커버리지 감사해줘. 한국어로 말할 때 안 걸리는 것부터.
```

Per skill it generates 20 concrete test queries — 10 that should trigger (formal and natural English,
natural Korean, implicit needs, one where a sibling skill competes) and 10 near-misses that share
keywords but need something else — scores each against the current description, and reports
`(correct / 20) × 10`. Judged by default; when you ask, measured by running each query through
headless `claude -p` three times (fired at 2 of 3). Measured rewrites iterate on 12 queries, at most
three times, and keep the description that scores best on the 8 held out. Named failure patterns: Korean blind spot,
keyword-only, jargon wall, too narrow, too broad. The rewrite starts with `Use when`, stays within 250 characters, and follows a fixed shape:

```
Use when [situation/intent]. Triggers on: "[한국어 구어체]", "[English phrase]", "[implicit case]".
```

Batch runs lead with a summary table and give full reports only for skills scoring below 7; 7+ is
"acceptable — no action needed". After applying, it follows the repo's update workflow —
bump the version in `marketplace.json`, update the plugin `README.md` and `KOR.md` together, commit.

### `audit`

Answers "what am I missing here?" from files, not memory. It inventories the workspace by name —
`.claude/settings*`, `.mcp.json`, hooks, `CLAUDE.md`, installed plugins, the skills in this session,
and `.env*` key names (never values) — then matches the gap against the catalogs this install can
see: the session skill list and the marketplace manifests and READMEs under `~/.claude/plugins`. Only
when those have nothing does it look at `_reference/external-skills.md`, and any hit there is labelled
*candidate, unverified*. Every table row cites a source path; no path means the row is dropped or
says `no match`. Read-only: a skill-shaped gap goes to `create`, a hook or permission to
`update-config`. Not for installing the harness (`harness:install`).

```
뭘 더 설치하면 좋아? 지금 이 레포에 뭐가 깔려 있는지부터 봐줘.
```

## Renames

`skill-quality-assurance` is now `quality-assurance` and `skill-trigger-validator` is now `trigger-validator`. The old `skill:skill-quality-assurance` / `skill:skill-trigger-validator` invocations no longer resolve; use `skill:quality-assurance` / `skill:trigger-validator`.

## Related plugins

- `write:writing-skills` — the authoring guide these two check the output of.

---
