# Reviewer panel — detail

Step 2 of `SKILL.md`. The roster (A–D) is in the SKILL.md table and never changes. The debate
follows think:brainstorming's debate mode (`think/skills/brainstorming/references/debate.md`),
adapted from design options to review findings. The Clashes block is the only record: no debate
log file is written.

## Models

`sonnet` for every reviewer and every attack (pass `model: "sonnet"` on each Agent call). The
session model for merge, cut (rule S), scoring and the final blocks.

## Steps

1. **Ledger first.** Steps 0–1 of `SKILL.md` run once in the main context: format, tallies,
   the numbered C/A/L/R/F lists. That ledger is what reviewers cite.
2. **Diverge (round 1).** Start four subagents in one message, one per roster row, each with its
   own persona text from `personas.md`. Each gets the document and the ledger, never another
   reviewer's output, and returns, in its persona's voice:
   - up to 5 findings: the ledger ID it supports (or `new:<C|A|L|R|F>`, naming the block it belongs to), a quoted document line, what that
     line shows or fails to show, no criticism of other reviewers;
   - a score per rubric dimension with the quoted evidence for it.
3. **Merge.** Claude dedupes the findings across reviewers. Claude gives every `new:<X>` finding
   the next free ID in block X (`C` / `A` / `L` / `R` / `F`) here, before the attack rounds; the ID
   stays through attack, cut and the Clashes block. A finding no reviewer can tie
   to a quoted line is cut here. Order: severity, then the focus persona's findings first when
   the user named one.
4. **Attack / rebut (rounds 2–3, at most 2).** Start four subagents in one message again, one per
   reviewer, each its own `sonnet` Agent call with its own persona text, reading the merged list
   with the other reviewers' findings, using `think:devils-advocate` as the attack method. One
   subagent playing several reviewers is not the panel: a reviewer whose own call does not return
   is missing for that round, named in the Clashes block. Per finding it opposes it writes one
   attack; per attack on a finding it backs it writes one rebuttal. A reviewer never rebuts its own
   attack and never both attacks and backs one finding; a rebuttal by the attacker is discarded.
   An attack carries:

   ```
   <finding ID> · steel-man: <the finding at its strongest, one line>
   objection: <why the document contradicts it, quoting the contradicting line, or why the quote does not carry it>
   type: structural | assumption | execution | timing · severity: low | medium | high | critical
   precedent: <a real failure pattern this resembles> | speculative
   ```

   Never invent a precedent: write `speculative`. An attack carries no core vulnerability and no
   reversibility; those are written once, by Claude, in 핵심 취약점. Stop after round 2, or
   earlier when a round adds no new objection.
5. **Rule S (cut).** A finding survives if it still points to a quoted document line and no
   attack showed the document contradicts it. Claude applies the rule; reviewers do not vote, and
   a count of attackers never decides. A dropped finding leaves the appendix and every front block.
6. **Score.** Claude sets one score per dimension by `scoring-rubric.md` from the surviving
   findings; reviewer scores and their evidence are inputs, not averaged.
7. **Write.** The Output Template of `SKILL.md`, plus the Clashes block.

## Clashes and ID contract

Format, one literal line per contested finding, three fields separated by ` — `:

```
<finding ID> — <who disagreed> — survived|dropped
```

`<finding ID>` always matches `^[CALRF]\d+$`; `new`, `신규` labels and `N<n>` are never written.
`<who disagreed>` names reviewer letters and the move, and each attack keeps its parts:
`B attacked (execution, high; steel-man: <one line>; precedent: speculative), A rebutted`.
It carries no ` — `. A finding no attack touched has no entry. Above the entries one panel line:
`패널 / Panel: A Staff · B EM · C Tech Lead · D OSS/DevTools — sonnet, <n> rounds`; it is not an entry. `survived` and `dropped` are the
only closing words, lower case.

Entry rules, panel run and revision mode alike:

- `<finding ID>` is the bare ID (`F2`): no parenthetical, note or annotation on it.
- The closing word is the last token of the line: nothing follows `survived` or `dropped`, no
  reason in parentheses.
- Reason text and any 판정 sentence go inside `<who disagreed>` or are left out; never between it
  and the closing word. A 판정 sentence is not an entry.

```
wrong: C1 — B attacked, A rebutted — survived (reason text)
wrong: C1 (note) — B attacked — 인용문이 근거를 뒷받침하지 않음 — survived
right: C1 — B attacked (execution, high; steel-man: <one line>; precedent: speculative), A rebutted; the quoted line still carries it — survived
```

Before Write, check and fix:

- every entry line against `^[A-Z]+[0-9]+ — [^—]+ — (survived|dropped)$`;
- no entry names one letter as both attacker and rebutter (`B attacked …, B rebutted` is wrong);
- every appendix line against `^[CALRF][0-9]+ ` — no `- `, `* `, number or bold before the ID;
- every block heading written exactly as in the Output Template, both halves
  (`**[충돌 / Clashes]**`, never `[충돌]` or `[Clashes]`).

- No contested finding: `충돌 없음 / no clashes`.
- Appendix lines start with their ID and a space: `C1 `, `A1 `, `L1 `, `R1 `, `F1 `.
- Each 우선순위 item ends `근거: <appendix ID>` naming one surviving finding.
- Core vulnerability and reversibility appear only in 핵심 취약점.

## Fallback

Fewer than 2 subagents alive — no Agent tool, the calls fail, or fewer than 2 reviewers return —
means no panel. Run the single-context review as one interviewer reading for all four rows'
concerns (steps 1 and 3 of `SKILL.md`), and write the Clashes block as
`패널 미실행 / panel could not run — single-context review` plus the reason. With 2 or 3 reviewers
back, continue and add a line naming the missing reviewer to the Clashes block.

## Revision mode

The v1/v2 diff stays single-context (step 1). The same four reviewers get the new version only;
their findings are debated as above and the diff rows are not argued.
