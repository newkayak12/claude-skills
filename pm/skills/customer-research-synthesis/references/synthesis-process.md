# Synthesis Process — Step-by-Step Reference

## Step 1: Data Preparation

Before analysis, organize all raw inputs:
- Collect all interview transcripts, notes, survey exports into one workspace
- Tag each data point with source ID (Interview-01, Survey-042) to maintain traceability
- Do not start clustering until all data is collected — premature synthesis anchors on early inputs

**Minimum viable dataset for pattern claims:**
- 5+ interviews for a single user segment (below this, treat all findings as anecdotes)
- 20+ survey responses for quantitative theme claims
- 3+ usability sessions before declaring a UX pattern

---

## Step 2: Affinity Mapping (Thematic Clustering)

**Process:**
1. Extract atomic observations — one idea per note (digital sticky: quote + source tag)
2. Group silently: let themes emerge, don't pre-label clusters
3. Name each cluster with a verb phrase describing user behavior or pain (e.g., "struggles to find past invoices" not "navigation")
4. Count occurrences per cluster — this is your n=

**Cluster naming rules:**
- Use customer language, not product language ("can't track what they owe" not "visibility gap")
- Each cluster should answer: "What is the user trying to do or experiencing?"
- Aim for 5-10 top-level clusters; sub-clusters only when n > 5 within a theme

**Output format:**
```
Theme: [verb phrase in customer language]
n= [count] / [total participants]
Sample quotes: "[quote 1]" (Interview-03), "[quote 2]" (Survey-017)
Strength: Pattern / Anecdote (see Step 3)
```

---

## Step 3 + 4: Pattern Judgment & JTBD Extraction (run in parallel after Step 2)

> [think-tool]: Use think-tool here to verify pattern/anecdote judgment logic and JTBD extraction before committing to output.

### Step 3: Pattern vs. Anecdote Distinction

| Signal Type | Threshold | Treatment |
|-------------|-----------|-----------|
| Strong pattern | n ≥ 5 AND ≥ 30% of participants | Include in top findings; feeds prioritization |
| Weak pattern | n = 3-4 OR 15-29% of participants | Include as secondary finding; flag as needs replication |
| Anecdote | n = 1-2 OR < 15% of participants | Document separately; do not generalize |
| Outlier | Contradicts the pattern | Document explicitly — often reveals edge cases or secondary segments |

**The anecdote trap:** A vivid quote from one participant dominates a readout unless you show n= counts. Always show the number.

### Step 4: Jobs-to-be-Done Extraction

> [think-tool]: Use think-tool to validate that each JTBD is specific enough to design against — reject abstractions like "users want to be productive."

**Extraction questions per major theme:**
- What is the user ultimately trying to achieve? (functional job)
- What does success feel like for them? (emotional job)
- How do they want to be perceived by others? (social job)
- What are they doing today instead? (current solution)

**JTBD format:**
```
When [situation], I want to [motivation], so I can [expected outcome].
Current workaround: [what they do today]
Pain with current approach: [what fails about it]
```

**Example:**
```
When I need to follow up on an overdue invoice, I want to know immediately
which clients owe me and by how much, so I can prioritize outreach
without checking multiple spreadsheets.
Current workaround: Cross-referencing Excel + email + accounting software
Pain: Takes 20+ minutes; often miss clients; embarrassing to chase wrong amount
```

---

## Step 5: Insight Summary Cards

One card per major finding. This is the deliverable that travels — into the PRD, prioritization session, team wiki.

**Card format:**
```
INSIGHT: [one-sentence headline in customer language]

Observation: [What did participants actually say/do? Behavioral, not interpretive]
Evidence: [n=X/Y participants; specific quotes with source IDs]
Implication: [What does this mean for the product? What decision does this inform?]
Confidence: High / Medium / Low
Open questions: [What would we need to know to act with higher confidence?]
```

**Example:**
```
INSIGHT: Users lose trust in the product when approval status is invisible

Observation: Participants navigated away from the submission screen to check
email for confirmation, even when the UI showed a spinner.
Evidence: 7/10 interviews; "I never know if it went through" (Int-02, Int-07, Int-09);
NPS open-ends: 12% of verbatims mention "uncertainty" or "don't know if..."
Implication: Real-time status visibility is table-stakes, not a nice-to-have.
Confidence: High
Open questions: Does the issue persist after first successful submission?
```

---

## Step 6: Recommendation and Hypothesis Chain

Every insight generates at least one recommendation and one testable hypothesis.

```
Insight → Recommendation → Hypothesis

Insight: Users lose trust when status is invisible
Recommendation: Build real-time approval status with explicit confirmation state
Hypothesis: We believe adding real-time status confirmation for [B2B submitters]
will reduce support tickets about "did my submission go through?" by 40%.
We'll know we're right when ticket volume drops within 3 weeks of release.
```

Feeds directly into:
- `../hypothesis-driven-dev/SKILL.md` — hypothesis handoff
- `../feature-prioritization/SKILL.md` — insight cards as evidence
- `../prd-development/SKILL.md` — problem statement + JTBD

---

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Leading with quotes, not patterns | One vivid quote hijacks the room | Always lead with n= counts; save quotes for illustration only |
| Synthesizing during data collection | Early themes anchor later coding | Collect all data first; synthesize in a dedicated session |
| Skipping implications | Observations without "so what" don't change decisions | Every insight card must have an Implication field |
| Mixing segments | B2B and B2C users have different jobs | Cluster within segments before comparing across them |
| Over-confidence on small n | "Users want X" when n=2 | Use explicit confidence levels; never generalize from n<3 |
| JTBD too abstract | "Users want to be productive" is not actionable | JTBD must include situation, motivation, and outcome |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Are all findings tagged with n= counts? | Anecdotes treated as patterns | Add counts; separate pattern from anecdote explicitly |
| Does each insight have an Implication? | Research sits on a shelf | Write "so what?" for every observation |
| Are Jobs-to-be-Done extracted, not just pain points? | Solutions address symptoms | Apply JTBD extraction questions to each major theme |
| Does the synthesis feed a hypothesis? | Learning doesn't reach the build process | Connect each insight card to a testable hypothesis |
| Are segments analyzed separately? | Mixed averages hide real signal | Re-run clustering per segment if 2+ distinct user types |
