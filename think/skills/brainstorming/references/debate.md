# Debate mode — detail

Runs steps 3a–3b of brainstorming as a debate between three personas. Steps 1–2 and 4–5 are
unchanged. The skill works the same without any pane; `/brainstorming-status` (think mod) only
reads the log.

## When

- The user asks: "토론으로", "토론 모드", "debate", "argue it out".
- Or Claude offers it in one line and the user says yes. Offer only when one holds:
  one-way door (hard to undo), cross-functional (several teams pay for it), or the finalists
  are not separated by the kill-criteria. Example offer:
  > 되돌리기 어려운 결정이라 페르소나 3명 토론으로 돌려볼까요? (토큰 약 3배)
- Never start it unasked.

## Steps

1. **Personas.** Pick 3 that would genuinely disagree on this topic (e.g. on-call SRE, product
   owner, cost-focused architect). Show name + one-line stance + model; wait for OK or a swap.
2. **Diverge (round 1).** One subagent per persona, run in parallel, each named model
   (`sonnet` by default). Each gets the confirmed problem and context, not the others' output,
   and returns 1–3 options. No criticism yet.
3. **Merge.** Claude dedupes into options `O1..On` (3–5) and logs one `merge` line per option.
4. **Attack / rebut (rounds 2–3, max 2).** Each persona, as a devils-advocate subagent, reads the
   log so far (others' lines included) and attacks options it opposes or defends options it backs.
   Stop early when a round adds no new objection.
5. **Cut.** Claude applies the written kill-criteria (SKILL.md 3b) — personas do not vote. One
   `cut` line per eliminated option with the criterion, then one `result` line naming the finalists.
6. **Output.** The normal Output Template plus `[충돌 / Clashes]`: who clashed with whom, on which
   option, and whether the objection survived the cut.

## The other model (automatic, no ask)

When `ask.mjs` and the other CLI are available, one debater is the other model: from Claude Code
→ `--to codex`, from Codex → `--to claude`. Nobody has to ask; the user sees it in the personas
list (`+ codex, the opposing side`). It counts as one of the debaters, not a fourth.

**Availability.** Skip it, and say "other model: not used (<reason>)" on the report line, when:
`SECOND_OPINION_DEPTH` is set (we are already a second opinion) · `ask.mjs` not found · the CLI
not installed. Find `ask.mjs`: `${CLAUDE_PLUGIN_ROOT}/../agents/scripts/ask.mjs`, else
`ls ~/.claude/plugins/cache/*/agents/*/scripts/ask.mjs | sort -V | tail -1`. A call that errors or
times out drops that debater, logs a `fallback` line for it and the debate goes on with the rest.
Never fails the skill.

**Calls** (read only, `--timeout 300`; codex's sandbox may be down, so the brief carries all the
material inline or via `--attach a,b`; claude takes `--model sonnet`):

- Round 1 is cold. Brief = the confirmed problem, context, constraints that are facts, "propose
  1–3 options with their strongest case; no criticism yet". Not our options, not our lean.
- Merge as usual: its options enter `O1..On`, logged `persona: "codex"` (or `claude`).
- Rounds 2–3: a new brief with the options so far, its own previous answer, and the rebuttals
  aimed at it; ask it to attack the options it opposes and defend its own. Now it may see our
  side: that is the debate. One call per round, same cap (2), same early stop.
- Its answers are claims. A point that decides a cut is checked against a file or a fact first.

**Fallback.** If a subagent fails or returns nothing and fewer than 2 personas remain, log a
`fallback` line, tell the user "debate mode stopped — continuing in normal mode", and finish
3a–3b yourself.

## Log

Path: `.claude/brainstorming/<slug>.jsonl` in the project (slug: short kebab-case of the topic;
create the folder). Append one line per utterance with Write/Edit (never rewrite earlier lines).
Claude appends the subagents' lines as they return.

```json
{"ts":"2026-10-14T10:02:11Z","round":2,"persona":"SRE","to":"O2","kind":"attack","text":"two queues double on-call"}
```

| field | value |
|---|---|
| `ts` | ISO time |
| `round` | 0 personas · 1 diverge · 2–3 attack/rebut · 4 cut/result |
| `persona` | speaker name; `Claude` for merge/cut/result/fallback |
| `to` | option id (`O1`), another persona, or `""`; for `persona` lines, the model |
| `kind` | `persona` · `option` · `merge` · `attack` · `rebut` · `support` · `cut` · `result` · `fallback` |
| `text` | ≤300 chars; for `merge`, the option's title |

`attack` counts against an option; `rebut` and `support` count for it. `result` or `fallback`
ends the debate.
