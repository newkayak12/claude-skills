# Interview Prep — Study Domain Structures

Shared reference for the interview-prep skill. Read this after completing Steps 1–4 of SKILL.md
(context gathering, company calibration, gap analysis, plan generation). Use the structures
here to fill in the domain-specific detail of the plan.

---

## Coding Study Structure

### Topic Sequencing

Study topics in dependency order. Do not start DP before mastering recursion.

Recommended sequence for most candidates:
1. Arrays, strings, hash maps (foundation — fast to review)
2. Two pointers, sliding window (pattern recognition)
3. Binary search (often underestimated)
4. Trees and recursion (required for almost all roles)
5. Graphs and BFS/DFS (required for senior roles)
6. Dynamic programming (highest ROI for hard problems)
7. Heaps, tries (role-specific)

### Practice Volume
- Beginner to coding interviews: 80–120 problems minimum before the interview
- Already comfortable: 30–50 focused problems in weak areas + 10–15 mocks
- Senior roles: problems alone are insufficient — system design preparation should equal coding prep in time investment

### Mock Interview Protocol

Do at least 3 full mock interviews with a timer before the real interview. Mocks reveal
communication habits that practice alone does not. Use a peer, interviewing.io, or role-play
with Claude (use portfolio-interview skill).

---

## System Design Study Structure

### Core Concepts to Master
- Load balancing and horizontal scaling
- Caching layers (CDN, application cache, database cache) and invalidation
- Database selection (SQL vs NoSQL tradeoffs, not just definitions)
- Asynchronous processing: queues, event streaming
- Consistency models: strong, eventual, read-your-writes
- Failure handling: retries, circuit breakers, idempotency
- Observability: logging, metrics, tracing

### Practice Format

For each design problem:
1. Spend 5 minutes on requirements clarification (scale, features, constraints)
2. Draw high-level architecture before details
3. Deep dive on one component with full tradeoff discussion
4. Address failure modes explicitly
5. Discuss monitoring

Practice problems in increasing complexity: URL shortener → rate limiter → newsfeed → distributed cache → payment system

---

## Behavioral Prep (STAR Method)

Every behavioral story needs four parts:
- **Situation:** Context — what was the setup?
- **Task:** Your specific responsibility — not the team's, yours
- **Action:** Concrete steps you took — not what "we" did
- **Result:** Measurable outcome — what changed because of your actions?

### STAR Story Bank — Prepare Distinct Stories For:
1. Most impactful technical decision you made
2. A time you disagreed with a team member or manager — and how it resolved
3. A project that failed or went wrong — what you did and what you learned
4. A time you went beyond your role or showed initiative
5. A time you mentored or helped grow someone else
6. Handling ambiguity with no clear requirements
7. Delivering under significant time pressure

Polish means: each story is under 3 minutes when spoken aloud, ends with a concrete result,
and uses "I" not "we" for the actions.
