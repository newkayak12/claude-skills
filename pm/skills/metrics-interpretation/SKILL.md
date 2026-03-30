---
name: metrics-interpretation
description: >-
  Use when a number moved unexpectedly and you need to understand why before deciding
  what to do. Triggers on: "지표가 떨어졌어", "retention 하락", "conversion drop",
  "A/B test 결과 해석", "KPI 이상", "metrics dropped", "why did this metric change",
  "dashboard 분석해줘". Best for: diagnosing an unexpected metric drop or spike;
  interpreting A/B test results and making a ship decision; turning a weekly metrics
  review into action items. Not for: defining which metrics to track (use okr-planning
  or prd-development); post-launch feature evaluation (use post-launch-retrospective).
type: workflow
theme: pm-data
best_for:
  - "Diagnosing an unexpected metric drop or spike"
  - "Interpreting A/B test results and making a ship decision"
  - "Turning a weekly metrics review into action items"
scenarios:
  - "우리 retention이 갑자기 떨어졌어. 뭐가 문제인지 분석해줘."
  - "Our conversion dropped 15% last week. How do I figure out why?"
  - "A/B test results are in — how do I interpret them and decide?"
  - "Weekly 지표 리뷰에서 이상한 숫자가 나왔어. 분석해줘."
  - "How do I know if this metric change is real or just noise?"
  - "DAU 급락 원인을 체계적으로 찾는 방법 알려줘."
estimated_time: "30-60 min"
compatibility:
  recommended:
    - think-tool
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 세그멘테이션 가설을 체계적으로 검토하고 인과관계와 상관관계를 구분하는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Metrics Interpretation

Turning dashboard numbers into decisions — by finding what actually moved, why it moved, and what to do about it.

## Core Principle

A metric change is not a diagnosis. It is a symptom. Your job is to work from symptom to cause to action, without skipping steps. Jumping from "DAU dropped 15%" to "let's ship a feature" skips the part where you find out whether it was a data pipeline issue, a seasonal effect, a competitor launch, or a real product problem.

---

## The Investigation Framework

Use this three-step sequence every time a metric changes unexpectedly.

### Step 1 — What moved?

Before investigating causes, confirm the change is real.

**Dashboard reading checklist:**
- [ ] Is the time range set correctly? (Day-over-day vs. week-over-week vs. month-over-month can show opposite signals)
- [ ] Is this a data pipeline issue? (Check if raw event counts dropped, not just derived metrics)
- [ ] Did the metric definition or tracking code change recently? (Check changelog, data team Slack)
- [ ] Is this affecting all platforms or just one? (iOS vs. Android vs. web)
- [ ] Is this affecting all user segments or just one? (new vs. returning, geo, cohort, plan tier)
- [ ] Is this within normal variance? (Check the same metric for the same period last year, last month)
- [ ] Did anything launch recently? (Feature release, marketing campaign, pricing change)

**Output of Step 1:** Confirm that the change is real, quantify the size, and isolate which segment(s) it affects.

---

### Step 2 — Why did it move?

Work top-down: start with the highest-level segmentation, then drill.

**Segmentation approach:**

1. **By acquisition channel** — Did traffic quality change? (Paid users vs. organic vs. referral)
2. **By user cohort** — Is it affecting new users, existing users, or both?
3. **By geography** — Is it concentrated in one region?
4. **By device / platform** — iOS, Android, web, or specific browser/OS version?
5. **By feature area** — Which part of the product does the drop trace back to? (Funnel analysis)
6. **By time-of-day / day-of-week** — Is it a specific time window? (Suggests infra or content issue)

**Funnel drill-down for conversion drops:**
- Start at the final conversion event and work backward step by step
- Find the step where drop-off increased; that's where the problem lives
- Then check whether the step itself changed (UX, copy, load time) or whether the incoming traffic quality changed

**Ask the "5 Whys" once you have a suspect:**
> DAU dropped → new user activation dropped → onboarding step 3 completion dropped → the email verification step was added last week → the email deliverability rate to Gmail addresses is 40%.

**Output of Step 2:** A specific, falsifiable hypothesis. "The drop in DAU is driven by a 35% decrease in new user activation in the EU, starting September 12, coinciding with the GDPR consent prompt change."

---

### Step 3 — What do we do?

Match the action to the cause type.

| Cause Type | Example | Action |
|-----------|---------|--------|
| Data / tracking issue | Pipeline broke, metric definition changed | Fix tracking; don't ship features to fix a bad dashboard |
| External / seasonal | Holiday, competitor launch, market event | Document; adjust forecast baseline; no product action needed |
| Infrastructure / bug | Slow load time, broken feature on one platform | Engineering fix; prioritize by user impact |
| Product regression | Recent change hurt a key flow | Rollback or fast-fix; post-mortem |
| Intentional trade-off | New friction added for compliance | Verify impact is within expected range; communicate to stakeholders |
| Structural product problem | Low retention in a core cohort, persistent drop | Discovery process; don't patch — diagnose root cause first |

---

## Common Metric Traps

Knowing these prevents bad decisions.

**Correlation is not causation**
> "Signups increased the week we launched the new homepage" does not mean the homepage caused the increase. Check: was there a campaign, a PR mention, a seasonal effect, or a competitor outage that week?

**Goodhart's Law**
> "When a measure becomes a target, it ceases to be a good measure." If a team optimizes hard for DAU, they'll start sending notifications that inflate DAU without creating real value. Watch for metrics that move but don't co-move with business outcomes.

**Survivorship bias**
> Analyzing only retained users' behavior to improve retention will show you what power users do — not what causes users to stay. Include churned users in your analysis.

**Aggregation hides the truth**
> Overall retention can be flat while new-user retention collapses and old-user retention improves. Always segment before concluding.

**Vanity metrics**
> Total registered users, total downloads, total page views — these can grow while the product is dying. Focus on active, engaged, retained, paid — metrics that require real user behavior.

**Short-term vs. long-term divergence**
> A feature can boost 7-day retention while hurting 30-day retention. Always check multiple time horizons before declaring a win.

---

## Connecting Metrics to Goals

When a metric change needs to be evaluated in the context of company goals:

- Check whether the metric is a Key Result in the current OKR cycle: `../okr-planning/SKILL.md`
- If it's a post-launch measurement, use the retrospective format: `../post-launch-retrospective/SKILL.md`
- If the metric change should influence what to build next, connect to: `../feature-prioritization/SKILL.md`
- If the metric is an experiment result, interpret against the original hypothesis: `../hypothesis-driven-dev/SKILL.md`

---

## Output Formats

### Metric change memo (for stakeholder communication)

```
Metric: [Name]
Change: [X% change, direction, time period]
Confirmed real: [Yes / No — reason]
Affected segment: [Who / where / what platform]
Root cause hypothesis: [One sentence]
Evidence: [2-3 data points supporting the hypothesis]
Recommended action: [Specific next step]
Owner: [Name]
Decision needed by: [Date]
```

### A/B test result summary

```
Test: [Name and hypothesis]
Result: [Variant vs. control on primary metric]
Statistical significance: [p-value or confidence interval]
Secondary metrics: [Did guardrails hold? Any unexpected effects?]
Segmented findings: [Any subgroup that behaved differently?]
Recommendation: [Ship / don't ship / iterate / run longer]
Caveats: [What could invalidate this result?]
```

---

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Structures the investigation sequence (What/Why/What to do) | Pulls actual dashboard data and segment breakdowns |
| Generates segmentation hypotheses to test | Validates hypotheses against internal context (releases, campaigns) |
| Identifies common metric traps and anti-patterns | Confirms with the data team whether tracking code changed |
| Drafts stakeholder memo and A/B test result summary | Makes the final decision on what action to take |
| Connects metric findings to OKRs and next steps | Owns the communication to leadership |

## Related Skills

- `../okr-planning/SKILL.md` — check whether the metric is a current Key Result
- `../post-launch-retrospective/SKILL.md` — if the change is post-launch, use the retro format
- `../feature-prioritization/SKILL.md` — metric evidence feeds prioritization decisions
- `../hypothesis-driven-dev/SKILL.md` — if the change is an experiment result, validate against original hypothesis

## Quick Diagnostic

| Symptom | Most Likely Cause | First Check |
|---------|-----------------|-------------|
| Metric dropped sharply on a single day | Bug, deploy, or data pipeline | Check release log and data team |
| Metric declining steadily over weeks | Product or market issue | Segment by cohort and channel |
| Metric spiked then returned to baseline | One-time event or marketing push | Check campaign and event calendar |
| Metric looks fine in aggregate but team feels something is wrong | Aggregation masking segment-level problem | Drill into new users vs. returning |
| A/B test result contradicts intuition | Novelty effect, wrong segment, or flawed instrumentation | Check segment behavior over time |
| Two metrics moving in opposite directions | Trade-off is real or metric definitions overlap | Document trade-off; choose primary |
