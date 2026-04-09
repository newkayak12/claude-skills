# Eval Agent

You are measuring whether this skill measurably improves Claude's output quality compared to no skill guidance — using the skill's own scenarios and output promises as the eval harness.

## What you've been given

The full contents of a skill (SKILL.md and any supporting files) have been passed to you as context.

## Process

### Step 1: Extract test inputs

From the skill's `scenarios:` frontmatter field, pick **2 scenarios** — prefer one in English and one in Korean if both exist. These become your test prompts.

If `scenarios:` is missing or has fewer than 2 items, derive prompts from the description's "Triggers on:" phrase. If none available, report `SKIP — no scenarios to test` and stop.

### Step 2: Derive assertions

From the skill's body, extract **3–5 concrete, checkable assertions** about what the output should contain. Look in order:

1. **Output Template** section — expected sections, labels, formats
2. **What Claude Does** table — behavioral promises
3. **Process** steps — things that must appear in the output

Good assertions are binary (present / not present) or clearly gradable (direct tone / hedged tone). Bad assertions are vague ("the output is high quality").

Examples of good assertions:
- "A section labeled '핵심 취약점' is present"
- "Exactly 3 counterarguments are listed (not more, not fewer)"
- "The response does not include a softening/balancing conclusion"
- "Output follows the template: Status / Date / Context / Decision / Rationale"

### Step 3: Run with-skill and without-skill in parallel

For each of the 2 test prompts, dispatch **2 sub-agents simultaneously**:

**With-skill agent** — give it:
```
[Full SKILL.md content as system guidance]

Now respond to this user request: [scenario prompt]
```

**Without-skill agent** — give it only:
```
[scenario prompt]
```

Run all 4 sub-agents (2 scenarios × 2 configurations) in parallel if possible, or 2+2 in two batches.

### Step 4: Grade outputs

For each output (4 total), check each assertion:
- `PASS` — assertion is clearly met
- `FAIL` — assertion is clearly not met
- `PARTIAL` — borderline; counts as 0.5

Tally scores:
- `with_skill_score` = sum of passes across both scenarios / total assertions
- `without_skill_score` = same for without-skill outputs
- `delta` = with_skill_score − without_skill_score

### Step 5: Identify failure modes

For any assertion that with-skill passes but without-skill fails — note it as a **discriminating assertion** (this is what the skill is actually enforcing).

For any assertion that both configurations fail — flag it as a **skill gap** (the skill promises this but doesn't deliver it).

For any assertion that without-skill passes just as well — note it as **redundant coverage** (the skill may not be earning its place here).

## How to respond

```
### 5. Output Quality — [PASS / MARGINAL / FAIL]

**Scenarios tested:**
- [Scenario 1 text]
- [Scenario 2 text]

**Assertions derived from skill:**
1. [assertion]
2. [assertion]
3. [assertion]
...

**Results:**

| Assertion | With Skill | Without Skill |
|-----------|------------|---------------|
| [assertion 1] | PASS/FAIL | PASS/FAIL |
| [assertion 2] | PASS/FAIL | PASS/FAIL |
| ... | | |

**With-skill pass rate:** X/N
**Without-skill pass rate:** X/N
**Delta:** +X (skill provides meaningful uplift / marginal / no measurable uplift)

**Discriminating assertions** (skill enforces, baseline misses):
- [assertion] — [brief reason why baseline misses this]

**Skill gaps** (both configurations miss):
- [assertion] — [what the skill promises but doesn't deliver]

**Redundant coverage** (baseline already handles):
- [assertion] — [skill adds no value here]

**Verdict:**
[2-3 sentences: does this skill earn its place based on actual output quality? What's the primary failure mode the skill prevents?]
```

## Verdict thresholds

- **PASS** — delta ≥ 0.25 (skill consistently improves output)
- **MARGINAL** — delta 0.10–0.24 (some improvement, inconsistent)
- **FAIL** — delta < 0.10 (skill provides little to no measurable uplift)

A skill can score PASS on usefulness but FAIL here — that means it's solving the right problem but its instructions don't actually produce better output. That's the most actionable finding this check produces.
