---
name: okr-planning
description: >-
  Use when defining team or company goals for a quarter, aligning cross-team
  efforts, or when goals exist but progress is unclear and teams are pulling in
  different directions. Triggers on: "OKR 설정", "분기 목표", "quarterly goals", "key
  results", 목표 정렬",
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
scenarios:
  - "Help me write OKRs for our team this quarter."
  - "우리 팀 OKR을 회사 목표에 연결되게 설계해줘."
  - "Our key results are all outputs (features shipped) — help me rewrite them as outcomes."
  - "이번 분기 OKR 그레이딩을 어떻게 해야 할지 모르겠어."
  - "How do we cascade company OKRs down to individual team OKRs?"
  - "팀이 OKR을 형식적으로만 쓰고 실제로 활용을 안 해. 어떻게 바꿀까?"
compatibility:
  recommended:
    - think-tool
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 OKR 간 정렬 논리와 stretch vs. committed 구분의 일관성을 검토하는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# OKR Planning Framework

A goal-setting framework that connects ambitious objectives to measurable key results, enabling organizations to align around what matters most and track progress transparently. Based on John Doerr's *Measure What Matters*, which traces OKRs from Intel's Andy Grove to Google's early growth to modern product organizations.

## Core Principle

**Ideas are easy. Execution is everything — and OKRs are how you translate ideas into execution.** An objective without a key result is a wish. A key result without an objective is a number without meaning. Together, they create a commitment: this is what we're trying to achieve, and this is how we'll know we achieved it. The discipline is not in writing OKRs — it is in saying no to everything that doesn't serve them.

**The foundation:** OKRs work through four superpowers: Focus (pick the few things that matter most), Alignment (connect team OKRs to company OKRs transparently), Tracking (frequent, lightweight check-ins, not annual reviews), and Stretching (set goals that require you to grow, not just execute). CFRs — Conversations, Feedback, Recognition — are the cultural complement that makes OKRs more than a spreadsheet exercise.

## Scoring

**Goal: 10/10.** When evaluating an OKR practice, rate 0-10. A 10/10 means OKRs are ambitious, measurable, transparently shared, frequently reviewed with CFRs, and actively used to make prioritization decisions. Always provide the current score and specific improvements needed.

- **9-10:** Stretch OKRs, full transparency, weekly CFRs, OKRs drive real trade-off decisions, graded honestly
- **7-8:** OKRs exist and are reviewed, but ambition is low ("committed" not "stretch") and grading is generous
- **5-6:** OKRs written quarterly but rarely referenced; CFRs absent; OKRs are documentation, not decisions
- **3-4:** OKRs are top-down mandates with no team input; key results are outputs (features shipped), not outcomes
- **1-2:** OKRs exist on paper only; actual priorities are driven by other systems; no grading or accountability

## The OKR Framework

### 1. Objectives

**Core concept:** An objective is a qualitative, inspiring statement of what you want to achieve. It should be significant, concrete, action-oriented, and ideally inspirational. Objectives answer "where do we want to go?" — not "how do we get there?" and not "how will we measure it?"

**Why it works:** Quantitative goals alone are demotivating — they describe the metric, not the aspiration. Qualitative objectives provide the "why" that orients daily decisions: "Is what I'm doing right now helping us get there?" A good objective is memorable enough that people can recite it without looking it up.

**Key insights:**
- Objectives should be uncomfortable — if they feel completely achievable, they're not ambitious enough
- Three to five objectives per cycle is the maximum — more dilutes focus and signals inability to prioritize
- Objectives should be set from both top-down (company direction) and bottom-up (team insight)
- The best objectives describe a destination the team hasn't been to before
- Avoid: "Improve X" (vague) or "Continue doing Y" (not aspirational) or "Ship Z" (output, not direction)
- An objective that doesn't help you say no to things isn't doing its job

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Company objective | Inspiring direction | "Make our product the undisputed leader in SMB invoicing" |
| Team objective | Concrete aspiration | "Slash onboarding friction so new users hit their first win in minutes, not days" |
| Personal objective | Meaningful challenge | "Become the go-to person for data infrastructure decisions in the org" |
| Bad objective (too vague) | Avoid "improve" | ❌ "Improve user experience" → ✅ "Make our app feel as fast and familiar as a native tool" |
| Bad objective (output) | Avoid "ship" | ❌ "Launch mobile app" → ✅ "Reach customers wherever they work" |

### 2. Key Results

**Core concept:** Key results are the measurable milestones that prove the objective was achieved. They are quantitative, verifiable, and time-bound. A good key result has a number — not "improve," "increase," or "reduce," but a specific, measurable change. Key results answer "how will we know we got there?"

**Why it works:** Without measurable key results, objectives are aspirations with no accountability. Key results make success unambiguous: either the number was hit or it wasn't. This clarity forces honest conversations about whether the objective was truly pursued or just nominally endorsed.

**Key insights:**
- 3-5 key results per objective — more dilutes the signal
- Key results measure outcomes (behavior changes), not outputs (deliverables)
- "Verb + number + metric" is the formula: "Increase 30-day retention from 45% to 60%"
- All key results for an objective should collectively prove it was achieved — not just contribute to it
- Key results should be set at a level where hitting 70% feels like success (stretch) and hitting 100% means you aimed too low
- Leading vs. lagging: leading KRs predict future results (weekly actives); lagging KRs confirm past results (revenue)

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Outcome KR | Behavior change measurement | "Increase 30-day user retention from 45% to 62%" |
| Leading KR | Predictive metric | "Reach 10,000 weekly active users by end of quarter" |
| Quality KR | User satisfaction | "Achieve NPS ≥ 45 from current 31" |
| Business KR | Revenue outcome | "Grow ARR from $2M to $3.2M" |
| Bad KR (output) | Avoid deliverables | ❌ "Launch new dashboard" → ✅ "40% of users use the dashboard weekly within 30 days of launch" |

### 3. Stretch Goals and Committed Goals

**Core concept:** Doerr and Grove distinguish two types of OKRs: committed (must be achieved — operational targets where 100% is expected) and aspirational/stretch (moonshots where 70% is success and 100% means the goal was too easy). Both are necessary. Confusing them destroys the system.

**Why it works:** If all OKRs are committed, teams set safe goals. If all OKRs are stretch, teams have no reliability signal. The distinction makes accountability honest: committed OKRs failing is a problem; stretch OKRs hitting 70% is good news.

**Key insights:**
- Committed OKRs: operational SLAs, compliance targets, financial must-haves — 100% expected
- Stretch OKRs: growth targets, innovation bets, market expansion — 60-70% = success
- Grading a stretch OKR at 40% → examine why; 100% → examine whether it was ambitious enough
- Never penalize teams for missing stretch goals — penalizing stretch kills innovation
- The CEO and board must visibly endorse the stretch culture or it won't survive in the org
- "Uncomfortably achievable" is the target zone for stretch OKRs

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Committed OKR | 100% expected | "Maintain 99.9% API uptime" — failure here is a real problem |
| Stretch OKR | 70% = success | "Increase monthly new user signups by 300%" — hitting 200% is a great result |
| Grading conversation | Honest assessment | "We hit 60% on revenue — why? What did we learn? What changes next quarter?" |
| Goal calibration | Test ambition level | "If we're confident we'll hit 100%, the goal isn't ambitious enough — raise it" |
| Cultural signal | Leadership models stretch | CEO sets a visibly ambitious OKR and grades it honestly, including misses |

### 4. Alignment and Cascading

**Core concept:** OKRs derive power from alignment: company OKRs inform department OKRs, which inform team OKRs, which inform individual OKRs. Crucially, this is not pure top-down mandate — teams contribute roughly 40% of their OKRs bottom-up, reflecting insights management doesn't have. Transparency is required: all OKRs, at all levels, should be visible to everyone.

**Why it works:** When teams can see the company objective and the department objective, they can make daily decisions that serve both without needing constant escalation. Transparency replaces command-and-control with shared context. Bottom-up contribution prevents the disconnection that occurs when people execute goals they had no voice in setting.

**Key insights:**
- All OKRs should be public within the organization — radical transparency is the default
- Top-down sets direction; bottom-up adds ground truth — both are necessary
- Cross-functional teams often share OKRs or have coordinating key results — this is healthy
- Alignment does not mean identical OKRs cascaded downward — translation is required at each level
- When a team's OKR doesn't clearly serve any company OKR, ask why the work is being done
- Horizontal alignment (between peer teams) is as important as vertical alignment

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Company → Team | Translate, don't copy | Company: "Lead in SMB" → Team: "Onboarding time under 5 min for SMB users" |
| Transparency | Public OKR dashboard | All OKRs visible in a shared tool (e.g., Notion, Lattice, Perdoo) |
| Bottom-up input | Team proposes OKRs | "What would move the needle most in our area? Here's our proposed OKR — does it align?" |
| Cross-team coordination | Shared or dependent KR | "Team A's KR: API response < 100ms. Team B's KR depends on this — make it explicit" |
| Orphan OKR | Flag misalignment | "This team OKR doesn't map to any company objective — let's discuss" |

### 5. CFRs — Conversations, Feedback, Recognition

**Core concept:** CFRs are the cultural complement to OKRs. Conversations are regular 1-on-1 check-ins about progress, learning, and obstacles — not status reports. Feedback is real-time, specific input on what's working and what's not. Recognition celebrates progress toward OKRs publicly, not just at year-end reviews.

**Why it works:** OKRs without CFRs become a spreadsheet exercise. CFRs transform OKRs from a tracking system into a continuous performance and learning culture. Doerr argues that CFRs replace the annual performance review — the only place where goals, feedback, and recognition were traditionally integrated.

**Key insights:**
- Conversations are weekly, not quarterly — "how are your OKRs going?" is a regular touchpoint
- Feedback should be specific and near-real-time: "That customer interview approach moved the learning fast — what did you learn?"
- Recognition is tied to OKR progress, not just results: "You tried something new and learned we were wrong — that's the right behavior"
- CFRs between peers, not just managers, build a feedback culture across the whole team
- Annual performance reviews that ignore quarterly OKR progress are disconnected from reality
- The manager's job in CFRs is coaching, not judging — "what's blocking you?" not "why didn't you hit your number?"

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Weekly check-in | OKR-focused conversation | "How are your key results tracking? What's the biggest obstacle right now?" |
| Real-time feedback | Specific, behavior-linked | "The way you reframed the OKR as a customer outcome in the all-hands — that's the right level" |
| Recognition | Public and OKR-connected | "Shoutout to [name] — their 60% toward the retention KR reflects genuine behavior change in the product" |
| Grading meeting | Honest, learning-focused | "We hit 45%. Here's what we learned. Here's what we're changing. Grade: 0.45" |
| Manager coaching | Obstacle removal, not accountability theater | "What would need to be true for you to get to 70%? What can I unblock?" |

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Key results as output lists | "Ship mobile app" is not a key result | Rewrite as outcome: "40% of users active on mobile within 60 days of launch" |
| Too many OKRs | Focus collapses; everything is equally important | Max 3 objectives, 3-5 KRs each — ruthlessly cut anything that doesn't serve the top priorities |
| OKRs as top-down mandates | Teams disengage; ground truth is lost | 40-60% bottom-up contribution; teams propose, leadership aligns |
| Grading generously to avoid discomfort | Accountability disappears; OKRs become theater | Grade honestly: 0.7 on a stretch OKR is success; 1.0 means aim higher next cycle |
| Annual OKR rhythm | Quarterly learning is lost; OKRs become stale | Quarterly cycles minimum; weekly CFR check-ins |
| No transparency | Teams can't align without seeing each other's OKRs | All OKRs public; shared dashboard accessible to everyone |
| Conflating committed and stretch | Teams set safe "stretch" goals; real stretch becomes impossible | Label each OKR explicitly: committed (100% expected) or aspirational (70% = success) |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Do key results have specific numbers? | KRs use "improve," "increase," "reduce" without targets | Rewrite with "Verb + from X to Y by [date]" |
| Are OKRs uncomfortable to commit to? | Goals are safe; 100% is expected and delivered | Raise ambition; if you're confident you'll hit 100%, the goal is wrong |
| Are all OKRs publicly visible across the org? | Silos prevent alignment; teams don't know what others are working toward | Put all OKRs in a shared, accessible tool |
| Do teams contribute 40%+ of their OKRs bottom-up? | All OKRs are top-down mandates | Build a bottom-up input session into the OKR cycle |
| Are OKRs graded honestly, including misses? | Grading is always 0.7-0.9 regardless of reality | Grade 0.0-1.0 honestly; examine both high and low scores |
| Do weekly conversations reference OKRs? | OKRs are set and forgotten until next quarter | Make OKRs the agenda for weekly 1-on-1s and team check-ins |
| Are CFRs happening alongside OKR tracking? | OKRs are a spreadsheet, not a culture | Add recognition, feedback, and coaching conversations as a regular practice |

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Rewrites output KRs as outcome KRs with measurable targets | Sets the actual ambition level based on business context |
| Scores OKR practice (0-10) with specific improvement steps | Conducts the CFR conversations with direct reports |
| Cascades company OKRs into team-level translations | Negotiates with leadership on stretch vs. committed labeling |
| Identifies orphan OKRs not connected to company objectives | Owns cross-team alignment and horizontal coordination |
| Provides CFR conversation starters for weekly check-ins | Makes final grading decisions and communicates them |

## Related Skills

- `../feature-prioritization/SKILL.md` — OKR alignment check for each backlog item
- `../roadmap-communication/SKILL.md` — link each roadmap item to an OKR narrative for stakeholders
- `../metrics-interpretation/SKILL.md` — check whether a metric change affects a current Key Result
- `../stakeholder-management/SKILL.md` — align stakeholders when cross-team OKRs conflict

## Further Reading

- [*"Measure What Matters: OKRs — The Simple Idea That Drives 10x Growth"*](https://www.amazon.com/Measure-What-Matters-Google-Foundation/dp/0525536221) by John Doerr
- [*"High Output Management"*](https://www.amazon.com/High-Output-Management-Andrew-Grove/dp/0679762884) by Andy Grove — the original Intel source for OKRs
- [*"Radical Focus"*](https://www.amazon.com/Radical-Focus-Achieving-Important-Objectives/dp/0996006028) by Christina Wodtke — a narrative guide to OKRs in practice

## About the Author

**John Doerr** is a venture capitalist at Kleiner Perkins who introduced OKRs to Google in 1999 after learning the framework from Andy Grove at Intel. Grove developed OKRs at Intel in the 1970s as an evolution of Peter Drucker's Management by Objectives (MBO), addressing MBO's failure to connect individual goals to organizational strategy. Doerr's *Measure What Matters* (2018) brought OKRs to mainstream business by documenting their use at Google, Bono's ONE Campaign, the Gates Foundation, and other organizations. The book is structured around case studies and includes contributions from Larry Page, Sundar Pichai, and Bono. OKRs are now used by organizations including Google, LinkedIn, Twitter, Uber, Microsoft, and thousands of startups worldwide.
