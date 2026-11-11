# Rounds — steps 1-7 as a staged, gated loop

Detail for the Process of `SKILL.md`. Steps 1-7 run as one harness-shaped pass, and the pass runs
n times. The record's schema belongs to `scripts/manage.mjs`: read the header comment at
`round --input` there; it is not copied here.

## n

n comes from the user; the default is 2. The `round` input's `n` is the last round number this loop
reaches (the highest `snapshot/rounds/round-N.json` already there, plus the user's n when a loop
resumes after an earlier one finished). n is fixed for the rounds of one loop: every round's `n`
equals the previous record's, and `round` is never past `n`. Round numbers run in order from 1
(round N>1 needs `round-(N-1).json`) and never overwrite one (default - revisit with the manage skill owner).

## The pass, in order

1. **Plan the round.** Write down the step list (1-7) and `started_from`: round 1 starts from the
   user's request; round N starts from round N-1's `gate.gaps` and its feedback ids (read them from
   `round-(N-1).json`; node recomputes the same two lists into the new record). Work the carried
   gaps first.
2. **Criteria.** Before doing a step, write its done-criteria: checkable on the workspace as it
   stands, never empty, with a criterion id (`c-select`, no slash or space) kept the same every
   round for the same criterion, so a reworded criterion stays the same gap. A step with nothing new
   to do still has criteria that read the current state ("every item `선정.md` lists exists under
   `sources/`"), so it is checked, not assumed. Record them before doing the step:
   `echo '{"round":N,"step":S,"id":"…","criteria":"…"}' | manage.mjs step --input -`.
3. **Do.** The actor (the session) does the step in context, as the Process says.
4. **Check.** Where a command exists, run it: step 1 `material gaps|foreign`; step 2 `selection`;
   step 3 `claims`, `verify`; step 4 `claims`, `settle`, `renumber`/`verify`, `compare`; step 5
   `deck-builder catalog`; step 6 `deck-builder check`, `claims --file portfolio-deck.mdx`; step 7
   `keep-render`. Otherwise (step 1 episode splitting, step 5 style rules, step 7 page reading) a
   judge checks it, and the judge is not the actor.
5. **Gate.** Record the verdict with `step` (`{"round":N,"step":S,"verdict":…,"by":…,"reason":…}`)
   before the next step's criteria: `step` refuses the next step until this one has its verdict, and
   stamps both with the engine's time. `fail` is fixed and re-checked before moving on, or left
   `fail` with the reason when the fix does not fit this round (a step that ran and missed a
   criterion). The verdict values are `pass`, `fail`, `skipped`.
6. **Record.** One `round` call per round, after the last step (or after the step that ended
   it), with no `steps` in its input: write `{round, n, feedback, feedback_mode,
   blocked?}` to `snapshot/rounds/in-N.json` and run `manage.mjs round --input
   snapshot/rounds/in-N.json` (that folder is left out of `changed`). `round` reads the seven
   verdicts `step` recorded and the record says `gate.order: recorded`; steps passed in the input
   are taken as given and say `caller`. `round` refuses fewer than seven verdicts, a `round-N.json`
   that exists, a missing or malformed `round-(N-1).json` (`previous record malformed`), an `n`
   that differs from the previous record's, and `round` past `n`, and writes nothing. A step with
   a part that could not run (step 4's interviewer or noah viewpoint headless) is one entry:
   `skipped`, the reason naming the part that did not run and what did run.
   Never fill a derived field (gaps, diff, `changed`, `started_from`, `stop_reason`, `continue`).
   `by` names who decided the verdict: a command, `judge:subagent` or `judge:in-context`.
   `manage.mjs round --read` prints every recorded round from the files alone.

## Judge is not the actor

The judge sees only the step's criteria and the artifact (a file path or its text), never the actor's
reasoning, and its verdict is `pass` or `fail` per criterion with the line it rests on.
- Run it as a fresh-context subagent, on a model tier other than the session's where one is
  available (pass `model` on the Agent call; never haiku). Where the Agent tool is there, use it.
- No subagent available (no Agent tool, or the calls fail): the actor judges in context, `by` says
  `judge:in-context`, and the report says so. A step the in-context judge passes is named in the report.
- A step no command and no judge can check is recorded `skipped`, reason `could not be checked`,
  counted as a gap, never `pass` and never `fail`.

## Feedback each round

`feedback` runs every round, after step 7, from the main context: never inside a subagent or a judge,
because its three-lens panel needs subagents and a subagent cannot start them (it would fall back to
one context without saying so). Its target is this round's deck (`build/deck.pdf`) when one exists,
else this round's `portfolio-skeleton.md`. A round never skips it and never reuses an output from before the
loop, from another round or from outside it: a round without its own feedback run is not recorded.
Save the output as `snapshot/rounds/feedback-N.md` and the next round's step 4 works its findings.

The findings are taken by node, not by reading: `manage.mjs intake --feedback
snapshot/rounds/feedback-N.md --round N` takes the 우선순위 items' `근거:` IDs and (panel mode) the
Clashes entries marked `survived`, text from the appendix, and writes `snapshot/rounds/findings-N.json`;
a `dropped` clash is not consumed, a 우선순위 item citing no ID comes back in `not_consumed` and the
report names it. Its `mode` is `panel` or `single-context` (the Clashes block says `패널 미실행`).
Run `manage.mjs settle --findings snapshot/rounds/findings-N.json`, continue with `kept`, show the
user `settled`. `kept` is the `feedback` of the `round` input and intake's `mode` its
`feedback_mode` (required when `kept` is not empty; without findings leave it out). `round` records
`feedback: {mode, ids}`, not the finding text.

## Skipped, never pass

A step that could not run is recorded `skipped` with its reason in `reason`, and `round` counts it
as a gap. A step is never recorded `pass` without running. An unusable tool (a missing, 0-byte or
unreadable file, a missing renderer or catalog) gives `skipped` with its reason, never `fail`;
`fail` is only for a step that ran and missed a criterion. Cases:
- step 5: `deck.catalog.md` or `template/analysis.md` missing, `template.pptx` 0-byte or unreadable,
  or no renderer;
- step 6: runs when `deck.catalog.md`, `template/analysis.md` and `portfolio-skeleton.md` all exist (the fixture
  workspace has them). A missing one, or a checker that cannot open the template (0-byte or
  unreadable `template.pptx`), is `skipped` and named in the reason;
- step 7: a round always builds (`deck-builder build`, then `verify-build`; the user's standing word,
  2026-11-03). `render` only when the user said so for this loop; without that word the render part is
  noted `not requested`, not a user-wait. Build impossible (no template, no builder) or no renderer
  when told: skipped with that reason.

## User-wait points

Steps 2 and 3, and a structure change in step 4, need an answer. It is taken in this order, first
that can answer:

1. **The user.** In a conversation, ask and wait in the step. A standing answer the user gave for the
   loop ("accept the proposed selection and structure") counts as theirs.
2. **noah.** No user to ask (headless) and noah connected: ask it, and answer from what it returns of
   the user's stated standards and corrections, quoted in `reason`.
3. **The proposal.** Neither: take the proposal as it stands, say so in `reason`, and go on.

Record who answered as the step's `answered_by` (`user`, `noah`, `proposal`) with its verdict. A
user-wait never ends a round or the loop (`round` refuses `waiting_user`); the report lists every
step answered by `noah` or `proposal`, for the user to confirm or change later.

## Loop and stop

After each `round` call read its printed `continue`. `continue: true` starts the next round
(from the gaps and feedback ids just recorded); `continue: false` ends the loop. The `stop_reason`
values are `n_reached`, `nothing_new` and `blocked`, first match wins in that
precedence: blocked, nothing_new, n_reached. `blocked` (input `blocked`) is for work
that cannot continue at all, with the reason.

`nothing_new` fires when any one of three clauses holds: no gap id absent from the previous round,
no new kept feedback id after settle (compared with round N-1's `feedback.ids`, or its ids when it was
written as the older `[{id,text}]` array), or no file changed since it. Round 1 has no clauses.

## Report

One report per loop, in the Output Template's shape, plus per round: its gate (verdict per step,
gaps), the diff to the previous round (resolved, carried, new), `stop_reason` and `continue`, the
skipped steps with reasons, the steps answered by `noah` or `proposal`, the priorities not consumed, the panel mode and the judge mode
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
