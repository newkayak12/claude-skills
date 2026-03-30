---
name: customer-research-synthesis
description: >-
  Use when raw qualitative research — interview notes, survey responses, session
  recordings — needs to become structured insights that drive decisions.
  Triggers on: "인터뷰 정리", "고객 인터뷰 분석", "리서치 결과 정리", "설문 분석", "VOC 정리",
  "UX research synthesis", "interview notes analysis", "what did users tell us".
  Best for: affinity mapping with n= counts; Jobs-to-be-Done extraction; insight
  cards that feed PRD or prioritization. Not for: quantitative survey stats (use
  metrics-interpretation); competitive research (use competitive-analysis).
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
scenarios:
  - "I have 10 interview transcripts — help me find the patterns."
  - "고객 인터뷰 결과를 정리해서 PRD에 넣을 인사이트로 만들어줘."
  - "Synthesize these survey verbatims into themes with evidence counts."
  - "인터뷰 노트에서 Jobs-to-be-Done을 뽑아줘."
  - "Which of these research findings are real patterns vs. one-off anecdotes?"
  - "VOC 데이터를 우선순위 결정에 쓸 수 있게 정리해줘."
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 패턴과 일화를 구분하는 판단과 JTBD 추출의 논리를 검증하는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Customer Research Synthesis Framework

A structured process for turning raw qualitative data — messy interview notes, survey verbatims, usability observations — into clear patterns, Jobs-to-be-Done, and insight cards that directly feed product decisions.

## When to Use / When Not to Use

| Use | Do Not Use |
|-----|-----------|
| Raw interview notes needing thematic structure | Quantitative survey with closed-ended stats |
| Verbatim quotes needing n= pattern analysis | Competitive research (use competitive-analysis) |
| Discovery research feeding a PRD or roadmap | Product analytics / behavioral data (use metrics-interpretation) |
| Post-research readout that needs insight cards | Research planning or question design |

## Core Principle

**Raw quotes are not insights. An insight requires an observation, supporting evidence, and an implication for what to build or change.** Most PMs stop at the quote. Synthesis means finding the pattern across multiple data points, distinguishing a genuine signal from a one-off anecdote, and translating that pattern into a hypothesis the team can act on.

**The synthesis chain:** Raw data → themes (affinity mapping) → Jobs-to-be-Done → insight cards → recommendations → hypotheses. Each step is distinct. Skipping straight from quotes to recommendations is how teams build the wrong thing with confidence.

## Agent Output

When a user provides raw interview notes or survey data, produce:
1. **Affinity clusters** — grouped themes with counts (e.g., "Pain: slow onboarding — mentioned by 6/10 participants")
2. **Top 3 Jobs-to-be-Done** extracted from the data
3. **Insight summary cards** — one per major finding (observation + evidence + implication)
4. **Pattern vs. anecdote verdict** for each finding
5. **Recommended hypotheses** — directly feeds `../hypothesis-driven-dev/SKILL.md`

When a user asks to **evaluate their synthesis practice**, rate 0-10:
- **9-10:** Patterns documented with n= counts; Jobs extracted; insight cards connect to product decisions; hypotheses written before building
- **7-8:** Themes exist but evidence counts are missing; insights stop at observation without implication
- **5-6:** Research done but summarized as a list of quotes; no pattern analysis
- **3-4:** "We talked to users" is treated as sufficient; no structured output
- **1-2:** No synthesis practice; product decisions made without reference to research

## Synthesis Process

### Step 1: Data Preparation

Before analysis, organize all raw inputs:
- Collect all interview transcripts, notes, survey exports into one workspace
- Tag each data point with source ID (Interview-01, Survey-042) to maintain traceability
- Do not start clustering until all data is collected — premature synthesis anchors on early inputs

**Minimum viable dataset for pattern claims:**
- 5+ interviews for a single user segment (below this, treat all findings as anecdotes)
- 20+ survey responses for quantitative theme claims
- 3+ usability sessions before declaring a UX pattern

### Step 2: Affinity Mapping (Thematic Clustering)

**Process:**
1. Extract atomic observations — one idea per note (digital sticky: quote + source tag)
2. Group silently: let themes emerge, don't pre-label clusters
3. Name each cluster with a verb phrase describing the user behavior or pain (e.g., "struggles to find past invoices" not "navigation")
4. Count occurrences per cluster — this is your n=

**Cluster naming rules:**
- Use customer language, not product language ("can't track what they owe" not "visibility gap")
- Each cluster should answer: "What is the user trying to do or experiencing?"
- Aim for 5-10 top-level clusters for a typical research set; sub-clusters only when n > 5 within a theme

**Output format:**
```
Theme: [verb phrase in customer language]
n= [count] / [total participants]
Sample quotes: "[quote 1]" (Interview-03), "[quote 2]" (Survey-017)
Strength: Pattern / Anecdote (see threshold below)
```

### Step 3: Pattern vs. Anecdote Distinction

This is the most important editorial decision in synthesis.

| Signal Type | Threshold | Treatment |
|-------------|-----------|-----------|
| Strong pattern | n ≥ 5 AND ≥ 30% of participants | Include in top findings; feeds prioritization |
| Weak pattern | n = 3-4 OR 15-29% of participants | Include as secondary finding; flag as needs replication |
| Anecdote | n = 1-2 OR < 15% of participants | Document separately; do not generalize; do not use as prioritization evidence |
| Outlier | Contradicts the pattern | Document explicitly — outliers often reveal edge cases or secondary segments |

**The anecdote trap:** A vivid, emotionally resonant quote from one participant will dominate a readout unless you have explicit n= counts. Always show the number. "One user said..." and "7 out of 9 users said..." are completely different evidence weights.

### Step 4: Jobs-to-be-Done Extraction

JTBD reframes observations as the underlying functional, social, and emotional jobs customers are hiring the product to do.

**Extraction questions to apply to each major theme:**
- What is the user ultimately trying to achieve? (functional job)
- What does success feel like for them? (emotional job)
- How do they want to be perceived by others in doing this? (social job)
- What are they doing today instead? (current solution = job is being done somewhere)

**JTBD format:**
```
When [situation], I want to [motivation], so I can [expected outcome].
Current workaround: [what they do today]
Pain with current approach: [what fails about it]
```

**Example:**
```
When I need to follow up on an overdue invoice, I want to know immediately
which clients owe me and by how much, so I can prioritize my outreach
without checking multiple spreadsheets.
Current workaround: Cross-referencing Excel + email + accounting software
Pain: Takes 20+ minutes; often miss clients; embarrassing to chase the wrong amount
```

### Step 5: Insight Summary Cards

One card per major finding. This is the deliverable that travels — into the PRD, into the prioritization session, into the team wiki.

**Card format:**
```
INSIGHT: [one-sentence headline in customer language]

Observation: [What did participants actually say/do? Behavioral, not interpretive]
Evidence: [n=X/Y participants; specific quotes with source IDs; quantitative data if available]
Implication: [What does this mean for the product? What decision does this inform?]
Confidence: High / Medium / Low (based on n= and source quality)
Open questions: [What would we need to know to act on this with higher confidence?]
```

**Example:**
```
INSIGHT: Users lose trust in the product when approval status is invisible

Observation: Participants repeatedly navigated away from the submission screen
to check email for confirmation, even when the UI showed a spinner.
Evidence: 7/10 interviews; "I never know if it went through" (Int-02, Int-07, Int-09);
NPS survey open-ends: 12% of verbatims mention "uncertainty" or "don't know if..."
Implication: Real-time status visibility is table-stakes, not a nice-to-have.
Confidence: High
Open questions: Does the issue persist after first successful submission,
or only on the first attempt?
```

### Step 6: Recommendation and Hypothesis Chain

Insight cards feed decisions. Every insight should generate at least one recommendation and one testable hypothesis.

```
Insight → Recommendation → Hypothesis

Insight: Users lose trust when status is invisible
Recommendation: Build real-time approval status with explicit confirmation state
Hypothesis: We believe adding explicit real-time status confirmation for [B2B submitters]
will reduce support tickets about "did my submission go through?" by 40%.
We'll know we're right when support ticket volume for this category drops
within 3 weeks of release.
```

This chain directly feeds:
- `../feature-prioritization/SKILL.md` — insight cards become evidence in the prioritization rubric
- `../prd-development/SKILL.md` — observation + JTBD become the problem statement and persona sections
- `../hypothesis-driven-dev/SKILL.md` — the hypothesis is handed off for experiment design
- `../pricing-monetization-strategy/SKILL.md` — willingness-to-pay signals extracted from "what would you pay" or "what would make you upgrade" verbatims

## Willingness-to-Pay Signal Extraction

When research will feed pricing work, flag WTP verbatims (e.g. "I'd pay $X", "this saves us $Y/month", "we left competitor because...") and pass them as a separate signal log to `../pricing-monetization-strategy/SKILL.md`. Do not analyze pricing here — that skill owns the WTP methodology.

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Leading with quotes, not patterns | One vivid quote hijacks the room | Always lead with n= counts; save quotes for illustration only |
| Synthesizing during data collection | Early themes anchor later coding | Collect all data first; synthesize in a dedicated session |
| Skipping implications | Observations without "so what" don't change decisions | Every insight card must have an Implication field |
| Mixing segments | B2B and B2C users have different jobs — averaging loses signal | Cluster within segments before comparing across them |
| Over-confidence on small n | "Users want X" when n=2 | Use explicit confidence levels; never generalize from n<3 |
| JTBD too abstract | "Users want to be productive" is not actionable | JTBD must include the situation, motivation, and outcome — specific enough to design against |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Are all findings tagged with n= counts? | Anecdotes are treated as patterns | Add counts before the readout; separate pattern from anecdote explicitly |
| Does each insight have an Implication? | Research sits on a shelf | Write "so what does this mean for the product?" for every observation |
| Are Jobs-to-be-Done extracted, not just pain points? | Solutions will address symptoms | Apply JTBD extraction questions to each major theme |
| Does the synthesis feed a hypothesis? | Learning doesn't reach the build process | Connect each insight card to a testable hypothesis |
| Are segments analyzed separately? | Mixed-segment averages hide the real signal | Re-run clustering per segment if you have 2+ distinct user types |

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Groups observations into affinity clusters with verb phrases | Conducts the actual interviews and recordings |
| Counts n= occurrences and flags pattern vs. anecdote | Judges whether each participant is a representative sample |
| Extracts Jobs-to-be-Done using the JTBD template | Validates JTBD accuracy against live customer context |
| Writes insight cards (observation + evidence + implication) | Makes final decisions on what to build based on insights |
| Chains insights to testable hypotheses | Decides experiment priority and runs the experiments |

## Related Skills

- `../feature-prioritization/SKILL.md` — insight cards as prioritization evidence
- `../prd-development/SKILL.md` — problem statement, personas, and Jobs-to-be-Done
- `../hypothesis-driven-dev/SKILL.md` — validated hypotheses ready for experiment design
- `../pricing-monetization-strategy/SKILL.md` — WTP signals from research
- `../product-discovery/SKILL.md` — triggered after the customer research phase completes
