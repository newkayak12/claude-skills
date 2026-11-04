# Rounds — steps 1-7 as a staged, gated loop

Detail for the Process of `SKILL.md`. Steps 1-7 run as one harness-shaped pass, and the pass runs
n times. The record's schema belongs to `scripts/manage.mjs`: read the header comment at
`round --input` there; it is not copied here.

## n

n comes from the user; the default is 2. The `round` input's `n` is the last round number this loop
reaches (the highest `snapshot/rounds/round-N.json` already there, plus the user's n); round
numbers continue from that file and never overwrite one.

## The pass, in order

1. **Plan the round.** Write down the step list (1-7) and `started_from`: round 1 starts from the
   user's request; round N starts from round N-1's `gate.gaps` and its feedback ids (read them from
   `round-(N-1).json`; node recomputes the same two lists into the new record). Work the carried
   gaps first.
2. **Criteria.** Before doing a step, write its done-criteria: checkable on the workspace as it
   stands, one line each, never empty. A step with nothing new to do still has criteria that read
   the current state ("every item `선정.md` lists exists under `sources/`"), so it is checked, not
   assumed.
3. **Do.** The actor (the session) does the step in context, as the Process says.
4. **Check.** Where a command exists, run it: step 2 `selection`; step 3 `claims`, `verify`; step 4
   `claims`, `settle`, `renumber`/`verify`, `compare`; step 5 `deck-builder catalog`; step 6
   `deck-builder check`, `claims --file deck.mdx`; step 7 `keep-render`. Otherwise (step 1 episode
   splitting, step 5 style rules, step 7 page reading) a judge checks it, and the judge is not
   the actor.
5. **Gate.** The next step starts only when the step's verdict is recorded. `fail` is fixed and
   re-checked before moving on, or left `fail` with the reason when the fix does not fit this
   round (a step that ran and missed a criterion). The verdict values are `pass`, `fail`, `skipped`.
6. **Record.** One `round` call per round, after the last step (or after the step that ended
   it). Write the input to `snapshot/rounds/in-N.json` and run
   `manage.mjs round --input snapshot/rounds/in-N.json` (that folder is left out of `changed`).
   `steps` holds exactly seven entries, one per step 1-7, never two for one step. A step with a
   part that could not run (step 4's interviewer or noah viewpoint headless) is one entry:
   `skipped`, the reason naming the part that did not run and what did run.
   Never fill a derived field (gaps, diff, `changed`, `started_from`, `stop_reason`, `continue`).
   `by` names who decided the verdict: a command, `judge:subagent` or `judge:in-context`.

## Judge is not the actor

The judge sees only the step's criteria and the artifact (a file path or its text), never the actor's
reasoning, and its verdict is `pass` or `fail` per criterion with the line it rests on.
- Run it as a fresh-context subagent, on a model tier other than the session's where one is
  available (pass `model` on the Agent call).
- No subagent available (no Agent tool, or the calls fail): the actor judges in context, `by` says
  `judge:in-context`, and the report says so. A step the in-context judge passes is named in the report.
- A step no command and no judge can check is recorded `skipped`, reason `could not be checked`,
  counted as a gap, never `pass` and never `fail`.

## Feedback each round

`feedback` runs once per round, at step 4, from the main context: never inside a subagent or a judge,
because its four-reviewer panel needs subagents and a subagent cannot start them (it would fall back to
one context without saying so). Its target is the rendered deck (`build/deck.pdf`) when one exists,
else `skeleton.md`. The report records the panel mode it ran: `4-reviewer panel` or
`single-context fallback`; the Clashes block's first line says which (format: `references/panel.md`
of `portfolio:feedback`).

Findings the round consumes, written as the `[{id,text}]` array step 4 already uses:
- the merged 우선순위 items, each with the appendix ID after `근거:` as `id` and the item's text;
- the Clashes entries marked `survived`, with the entry's finding ID as `id` and the finding's text;
  a `dropped` entry is not consumed.

A 우선순위 item that cites no appendix ID is not consumed: the report names it as not consumed.
Write the array to `snapshot/rounds/findings-N.json`, run `manage.mjs settle --findings` on it, continue
with `kept`, show the user `settled`. The `kept` array is the `feedback` of the `round` input, and the
input's `feedback_mode` is `panel` when the four-reviewer panel ran and `single-context` when it fell
back to one context. `feedback_mode` is required when `kept` is not empty; without findings leave it out.
`round` records `feedback: {mode, ids}` (the mode and the kept ids), not the finding text.

## Skipped, never pass

A step that could not run is recorded `skipped` with its reason in `reason`, and `round` counts it
as a gap. A step is never recorded `pass` without running. An unusable tool (a missing, 0-byte or
unreadable file, a missing renderer or catalog) gives `skipped` with its reason, never `fail`;
`fail` is only for a step that ran and missed a criterion. Cases:
- step 5: `deck.catalog.md` or `template/분석.md` missing, `template.pptx` 0-byte or unreadable,
  or no renderer;
- step 6: runs when `deck.catalog.md`, `template/분석.md` and `skeleton.md` all exist (the fixture
  workspace has them). A missing one, or a checker that cannot open the template (0-byte or
  unreadable `template.pptx`), is `skipped` and named in the reason;
- step 7: `build`/`render` only when the user said so for this loop. Without that word the step is
  skipped with the reason `not requested`; it is never `waiting_user`. With the word and no
  renderer, skipped with the reason `no renderer`;
- any step behind a user-wait point (next section).

## User-wait points

Steps 2 and 3, and a structure change in step 4, wait for the user in a conversation. When the user
gave standing answers for the loop ("accept the proposed selection and structure"), the proposal is
accepted; say so in the step's `reason`. In a headless run with no answer: propose, write nothing that
needs the answer, record the question as `waiting_user` and end the round. The steps that need the
answer, and those after them that read its output, are recorded `skipped` with the reason `waiting for
user`; steps that do not need it (1, 5) still run.

`waiting_user` ends the round, not the loop. `round` keeps `continue` true after it, and the next
round carries the question forward in `started_from`, unless no step can proceed: every step skipped,
or the last round reached, and then `continue` is false and the loop stops.

## Loop and stop

After each `round` call read its printed `continue`. `continue: true` starts the next round
(from the gaps and feedback ids just recorded); `continue: false` ends the loop. The `stop_reason`
values are `n_reached`, `nothing_new`, `waiting_user` and `blocked`, first match wins in that
precedence: blocked, waiting_user, nothing_new, n_reached. `blocked` (input `blocked`) is for work
that cannot continue at all, with the reason.

`nothing_new` fires only when all three clauses hold: no gap id absent from the previous round,
no new kept feedback id after settle (compared with round N-1's `feedback.ids`, or its ids when it was
written as the older `[{id,text}]` array), and no file changed since it. Round 1 has no clauses.

## Report

One report per loop, in the Output Template's shape, plus per round: its gate (verdict per step,
gaps), the diff to the previous round (resolved, carried, new), `stop_reason` and `continue`, the
skipped steps with reasons, the priorities not consumed, the panel mode and the judge mode
(`subagent` or `in-context`). The loop's report closes with where it stopped and why.

## Did it read better

After a round's edits, score the round's snapshot and the new skeleton with the same rubric in the
same turn: `feedback`'s five dimension scores and `pattern`'s items, each run as
`{ "<item>": <score> }` into `snapshot/scores/skeleton-vX.Y.Z.json`, then
`compare --before <snapshot's> --after <new>`, with both rounds' `claims` saved beside them
(`skeleton-vX.Y.Z.claims.json`) as `--claims-before`/`--claims-after`: a claim that lost its ground
(`lost_ground`) makes the round worse whatever the scores. Report every change; a `dropped` item
comes with the snapshot's wording, offered back; `unmatched` means re-score. This is step 4's
`compare` check in the pass above.
