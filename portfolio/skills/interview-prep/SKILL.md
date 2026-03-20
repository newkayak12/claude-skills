---
name: interview-prep
description: |
  Creates a personalized technical interview preparation plan based on the user's background,
  target company, and role. Covers coding, system design, and behavioral prep with a
  prioritized study schedule and weak-area identification.
  This is a planning skill — it produces a prep plan, not a live mock interview.
  Trigger on: "면접 준비", "interview prep", "코딩테스트 준비", "기술 면접 공부",
  "어떻게 준비해야", "면접 공부 계획", "FAANG 준비".
  Do not just list generic topics — gather the user's context first, then produce a specific plan.
---

# Interview Prep Planner

## Why Generic Prep Fails

"Study data structures and system design" is not a plan — it is a wish. Engineers who prepare without a structured plan study what they already know, avoid what they do not, and arrive underprepared in exactly the areas that matter for their target role.

A good prep plan starts with two facts: what the company actually tests, and what the candidate's current gaps are. Everything else follows from those two inputs.

---

## Workflow Note — Sequential Thinking and Parallelization

If `sequential-thinking` is available, use it to enforce this sequence: (1) gather context → (2) calibrate by company type → (3) identify gaps → (4) generate plan. Skipping gap analysis before planning is the most common failure.

Once Step 2 (company calibration) is complete, gap analysis (Step 3) and domain study structure generation (from `references/study-domains.md`) can be run in parallel.

---

## Step 1 — Gather Context

Before producing any plan, collect:

1. **Background:** How many years of experience? What is the current/recent role and tech stack?
2. **Target:** Which company or type of company? Which role level? (IC3 vs. Staff, for example)
3. **Timeline:** How many weeks until the interview (or target application date)?
4. **Interview format known?** (e.g., two coding rounds + system design + behavioral, or unknown)
5. **Biggest worry:** What area feels most uncertain right now?

If the user has already provided this, proceed directly to the plan. Do not ask for information already given.

---

## Step 2 — Company/Role Calibration

Different companies test materially differently. Calibrate the plan accordingly.

### FAANG / Top-Tier (Google, Meta, Amazon, Apple, Netflix-style)
- Coding: LeetCode medium/hard, emphasis on optimal time/space complexity
- System design: large-scale distributed systems, explicit tradeoff discussion expected
- Behavioral: leadership principles, specific STAR stories required (Amazon especially)
- Bar: correct solution is not enough — interviewers probe time complexity, edge cases, and alternative approaches

### Korean Tier-1 (Kakao, Naver, Line, Coupang)
- Coding: algorithm-heavy, often includes implementation-level problems (graph, DP, BFS/DFS)
- System design: architecture of real services, Korean-scale traffic considerations
- Cultural fit: collaborative style, team contribution, communication quality

### Growth-Stage Startups
- Coding: practical problems, less focus on extreme optimization
- System design: pragmatic choices, speed of delivery vs. scale tradeoff
- Behavioral: ownership, autonomy, self-direction — what did you initiate?

### Enterprise / B2B / Fintech
- Coding: often take-home or lower difficulty
- System design: reliability, observability, security
- Cultural: process maturity, documentation, stability-oriented decisions

Adjust topic weights based on the target. A perfect LeetCode hard solver who cannot discuss distributed systems tradeoffs will not pass a Google system design round.

---

## Step 3 — Weak Area Identification

For each major area, assess based on the user's description:

### Coding
- Can they solve medium LeetCode problems consistently in 30 minutes?
- Are they comfortable with: arrays/strings, hash maps, trees, graphs, dynamic programming, sliding window, two pointers, binary search?
- Do they communicate reasoning while coding (not just the final solution)?

### System Design
- Can they scope a system from vague requirements to a concrete design in 45 minutes?
- Do they address: API design, data modeling, scalability bottlenecks, caching, failure modes, monitoring?
- Do they drive the conversation or wait to be led?

### Behavioral
- Do they have 5–7 distinct STAR stories ready covering: ownership, conflict, failure, impact, leadership?
- Are stories specific (numbers, outcomes, personal role) or generic ("we improved the system")?

Flag specific gaps. The prep plan allocates study time in proportion to gap severity.

---

## Step 4 — Produce the Prep Plan

Structure the plan by week. Each week has:
- Primary focus area
- Specific resource or practice target
- Measurable milestone to verify the week worked

### Plan Template

```
## Interview Prep Plan
Target: [Company] [Role] — [N] weeks

### Week-by-Week Schedule

**Week 1: [Focus Area]**
- Goal: [Measurable outcome]
- Daily practice: [Specific activity]
- Resources: [Named, specific resources]
- Milestone: [How to verify the week was effective]

[Repeat for each week]

### Topic Priority List (by urgency)
1. [Highest gap / highest weight topic]
2. ...

### STAR Story Bank
[6–8 prompts for stories to prepare, matched to common behavioral questions]

### Final Week Checklist
[Mock interview, review weak areas, logistics prep]
```

---

## Domain Study Structures

For domain-specific study structures (coding topic sequencing and practice volume, system design core concepts and practice format, behavioral STAR story bank), read `references/study-domains.md` after completing Steps 1–4.

---

## Final Week

Do not study new material in the final week. Focus on:
- Two full mock interviews (coding + system design)
- Review your STAR stories aloud — hear how they sound, not just how they read
- Re-attempt your three hardest practice problems to rebuild confidence
- Logistics: time zone, Zoom setup, whiteboard tool if virtual, rest

The final week is consolidation, not cramming.
