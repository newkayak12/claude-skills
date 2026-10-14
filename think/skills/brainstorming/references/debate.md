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
