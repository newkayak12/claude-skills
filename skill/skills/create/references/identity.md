# House Identity

What makes a skill read as one of ours. Induced 2026-09-30 from ~30 skills read in full across every plugin
(greps over all 102), merged with the repo owner's coding guidelines (P11–P13). Structure is the least of it —
a skill with the right headings and none of this is not ours.

Each principle: the rule, what to check in a draft, evidence.

## P1. Re-checkable, not believable

Counts, quotes, IDs instead of adjectives. The output closes on one tally or verdict line the user can recount.

- Check: does the Output Template force a count or a quote somewhere? Is there a closing verdict line?
- "ALWAYS tally, never adjective" — `portfolio/skills/portfolio-feedback`
- "extract the profile as observable counts and quotes, never adjectives" — `write/skills/write-like-me`

## P2. Never supply a missing fact

Mark the gap (`[확인 필요: ○○]`, `unverified`) and stop there. A plausible filler is worse than an admitted gap.

- Check: does the skill say what to do when an input fact is absent — and is the answer "mark it", not "infer it"?
- "NEVER supply the candidate's missing fact" — `portfolio/skills/fit`
- "NEVER invent a precedent… One fake precedent discredits the whole critique." — `think/skills/devils-advocate`

## P3. The actor never grades itself

Verdicts come from another context and are relayed verbatim. A blocked run is a result, not something to route around.

- Check: if the skill judges quality, who judges — the same pass that produced the work? Hand the judging off.
- "NEVER author or soften it." — `graph/skills/orchestrate`
- "the author grading their own paper" — `completion/skills/verification-before-completion`

## P4. Withhold the comfortable move

Name the one thing a helpful assistant does by reflex in this task — recommend, balance, hedge, flatter, close on an
aphorism, pad to a count — and forbid it. This is the skill's reason to exist.

- Check: is there exactly one named reflex, written as NEVER/Do NOT, that a no-skill run would do?
- "NEVER balance. The user already knows the case for." — `think/skills/devils-advocate`
- "Do NOT add a recommendation unless explicitly asked." — `cognition/skills/tradeoff-articulator`
- "NEVER close with an aphorism, a quotation, or a three-option menu." — `think/skills/mentor`

## P5. Judgment first, each finding once

Lead with what the user can act on. State a finding once; evidence sits behind it and is cited, not restated.

- Check: does the template open with the verdict? Could any block repeat another?
- "front blocks cite it instead of restating it" — `portfolio/skills/fit`
- "if a defect appears in four blocks, three of them are padding" — `portfolio/skills/portfolio-feedback`

## P6. Say where it ends; hand off by name

A `Not for` line, and named handoffs in Related Skills. Never re-teach what another skill owns; say when standing in for one.

- Check: `Not for` present? Every adjacent job points to a real `plugin:skill`?
- "hand it to `devils-advocate` by name rather than doing it here" — `think/skills/back-to-basics`
- "the repo's rule is that invocation is visible" — `think/skills/mentor`

## P7. The user decides

Claude prepares, examines, executes. The user supplies what Claude can't see, chooses, runs the last step. Where the skill
takes a position, it labels it and names what would overturn it.

- Check: does the Claude / You table give the user the decision, not busywork?
- "they leave with better judgment, not with your answer" — `think/skills/mentor`
- "Say them in your own voice… Have a lawyer read any binding contract." — `think/skills/negotiate`

## P8. Missing input: mark and proceed, or ask one line

Never a menu. Read the repo / the source before asking anything it could answer.

- Check: is there a single-line ask, or a marker inside the output? No option lists?
- "That marker is the ask. Do not open with a question or a preamble." — `portfolio/skills/fit`
- "Never ask what the tree answers." — `teams/skills/plan`

## P9. A goal and a stop condition

Mandates end with a `Goal:` line. Every loop is bounded; "done" is a checkable criterion, not "looks good".
(Guidelines §4: turn the task into a verifiable goal, loop until verified.)

- Check: `Goal:` line? Each loop has a max and says what to report when it hits it? Does a Process step actually
  perform what the Goal promises? (A dry run's Goal said "the tally recounts to the table"; no step recounted, and the
  header came out 3·1 against a 2·2 table.)
- "A loop with no declared exit becomes editing that looks like progress." — `knowledge/skills/knowledge-workflow`

## P10. Rules carry their scar

A mandate states the failure that produced it, or a measured number. No rule without a reason.

- Check: can each NEVER/ALWAYS answer "what went wrong without it"?
- "Measured on a 94-question competency set: answers that opened no note cited the required note 14% of the time." — `knowledge/skills/knowledge-query`

## P11. Surface, don't pick silently (guidelines §1)

When the request reads two ways, name both. When a simpler route exists — an existing skill, a one-line rule in CLAUDE.md —
say so before building.

- Check: did intake confirm this needs to be a new skill at all?

## P12. Minimum skill (guidelines §2)

No section, mode, option, or "flexibility" that wasn't asked for. No handling for situations that won't happen.
If it's 200 lines and could be 80, it's 80.

- Check: delete each section in your head — does the skill get worse? If not, delete it for real.

## P13. Surgical (guidelines §3)

A skill that edits things touches only what the task names, matches the existing style, and mentions unrelated problems
instead of fixing them. Creating a skill touches only its own files plus the registration the repo requires.

- Check: if the skill edits files, does it say what it must not touch?

## Structure (lowest priority — follow the target plugin's siblings)

- Frontmatter: `name` (bare kebab, never repeats the plugin), `description` (`Use when…`, ≤ 250 chars, triggers only,
  KR + EN phrases), `scenarios` (2–3 EN, 2–3 KR), `compatibility` with a Korean `remote_mcp_note`.
- Body order: [Standing Mandates] → H1 → Process → Output Template → What Claude Does / What You Do (`| Claude | You |`) →
  Related Skills. Body English; Korean in triggers, scenarios, labels the user sees.

## Not identity (don't copy)

Line count targets, heading styling, emoji, Iron-Law code blocks, fixed default counts ("3 objections"), catalog-style
reference skills with no stance (`develop/skills/clean-code`, `develop/skills/sql-pro`).
