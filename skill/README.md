# skill

**English** · [한국어](KOR.md)

Two skills that inspect other skills. A SKILL.md can fail in two independent ways: it never fires
because its `description` gives Claude no signal, or it fires and then doesn't earn its place —
too heavy, badly structured, or no better than no skill at all. `skill-trigger-validator` measures
and fixes the first; `skill-quality-assurance` runs the six checks that cover the second, ending
in a prioritized fix list.

## Install & Uninstall

```bash
/plugin install skill@newkayak12-claude-skills
/plugin uninstall skill@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Review a skill before shipping and get a ranked list of what to fix | `skill-quality-assurance` |
| Fix a skill that doesn't fire on natural language, especially Korean | `skill-trigger-validator` |

## Skills

### `skill-quality-assurance`

Runs six quality checks on a skill and produces an actionable report. It reads every file in the
skill directory — `SKILL.md`, `agents/`, `references/`, `scripts/` — noting absent directories
rather than skipping the check, then dispatches checks 1–5 in parallel and check 6 after, since
output quality depends on knowing what the skill promised. It is the gate before publishing and
also useful mid-creation.

```
Review skill/skills/skill-trigger-validator before I ship it. Six checks, and tell me
what to fix first.
```

| # | Check | Agent | Verdict scale |
|---|---|---|---|
| 1 | Usefulness | `agents/usefulness-checker.md` | PASS / WARN / FAIL |
| 2 | Authoring principles | `agents/authoring-checker.md` | PASS / WARN / FAIL |
| 3 | Agent structure | `agents/structure-reviewer.md` | GOOD / IMPROVABLE / MISSING |
| 4 | MCP fit | `agents/mcp-advisor.md` | NONE / OPTIONAL / RECOMMENDED |
| 5 | SKILL.md weight | `agents/weight-analyzer.md` | LIGHT / OK / HEAVY / CRITICAL |
| 6 | Output quality | `agents/eval-agent.md` | PASS / MARGINAL / FAIL |

Check 6 measures with-skill against a no-skill baseline and reports both pass rates plus the
delta, the discriminating assertions the skill enforces, and the gaps it promises but doesn't
deliver. The report closes with **Top Improvements** — 🔴 must fix / 🟡 recommended / 🟢 optional —
written concretely enough to act on directly.

### `skill-trigger-validator`

Audits the `description` field, the only signal Claude uses when deciding whether to invoke a
skill, and rewrites it as a drop-in replacement. Point it at a single skill, a whole plugin, or
the entire repo; if no target is given it asks first. It touches only the frontmatter
`description`, never the body, and asks before applying anything.

```
develop 플러그인 스킬들 트리거 커버리지 감사해줘. 한국어로 말할 때 안 걸리는 것부터.
```

Per skill it generates 10 test queries — 2 formal English, 2 natural English, 3 natural Korean,
2 borderline that should *not* trigger, 1 implicit need — scores each against the current
description, and reports `(correct / 10) × 10`. Named failure patterns: Korean blind spot,
keyword-only, jargon wall, too narrow, too broad. The rewrite follows a fixed shape:

```
[What skill does]. Use when [situation/intent] — [English phrases], or Korean:
[한국어 구어체]. Also triggers on [implicit/borderline cases worth catching].
```

Batch runs lead with a summary table and give full reports only for skills scoring below 7; 7+ is
"acceptable — no action needed". If you accept the rewrites, it applies them and then follows
`INSTRUCT.md` — bump the patch version in `marketplace.json`, update the plugin README, commit,
push.

## Related plugins

- `write:writing-skills` — the authoring guide these two check the output of.

---
