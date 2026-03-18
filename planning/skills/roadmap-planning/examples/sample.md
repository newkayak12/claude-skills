# Roadmap Examples

### Example 1: Good Roadmap Planning (SaaS Product)

**Context:** Annual planning, need to align roadmap with retention and enterprise expansion goals.

**Phase 1 - Gather Inputs:**
- Business goals: Reduce churn from 15% to 8%, increase enterprise deals from 2/quarter to 5/quarter
- Customer problems: Onboarding confusion, enterprise SSO gap, mobile access issues
- Technical: Need to upgrade data pipeline for advanced reporting

**Phase 2 - Define Epics:**
- Wrote 12 epics with hypotheses (guided onboarding, enterprise SSO, mobile workflows, advanced reporting, etc.)
- Estimated effort: Onboarding = M (3 weeks), SSO = M (4 weeks), Mobile = L (2 months)

**Phase 3 - Prioritize:**
- Used RICE framework (recommended by `prioritization-advisor.md`)
- Scored: Onboarding (24,000), SSO (675), Mobile (2,000), Reporting (1,000)
- Strategic override: Boosted SSO priority (critical for enterprise expansion)

**Phase 4 - Sequence:**
- Q1: Guided Onboarding, Enterprise SSO, Mobile Workflows
- Q2: Advanced Reporting (depends on Data Pipeline in Q1), Slack Integration
- Q3: Mobile App (depends on API Redesign)

**Phase 5 - Communicate:**
- Presented to execs: "Q1 focuses on retention (onboarding) and enterprise expansion (SSO)"
- Feedback: "Can we add pricing page redesign to Q2?" → Adjusted roadmap
- Published: Internal roadmap (Confluence), external roadmap (Now/Next/Later)

**Outcome:** Clear, aligned roadmap with strategic narrative.

---

### Example 3: Epic Hypotheses (Phase 2)

```
Epic 1: Guided Onboarding
Hypothesis: We believe that adding a step-by-step onboarding checklist for non-technical users will increase activation rate from 40% to 60% because users currently drop off due to lack of guidance.
Success Metric: Activation rate (% completing first action within 24 hours)
Target: 40% → 60%

Epic 2: Enterprise SSO
Hypothesis: We believe that adding SSO for enterprise accounts will increase enterprise deals closed from 2/quarter to 5/quarter because enterprise buyers require SSO for security compliance.
Success Metric: Enterprise deals closed per quarter
Target: 2 → 5

Epic 3: Mobile-Optimized Workflows
Hypothesis: We believe that optimizing core workflows for mobile will increase mobile DAU from 5% to 20% because mobile-first users currently can't complete workflows on the go.
Success Metric: Mobile DAU as % of total DAU
Target: 5% → 20%
```

---

### Example 4: RICE Scoring Table (Phase 3)

| Epic | Reach | Impact | Confidence | Effort | RICE Score |
|------|-------|--------|------------|--------|------------|
| Guided Onboarding | 10,000 users | 3 (massive) | 80% | 1 month | 24,000 |
| Enterprise SSO | 500 users | 3 (massive) | 90% | 2 months | 675 |
| Mobile Workflows | 5,000 users | 2 (high) | 60% | 3 months | 2,000 |
| Advanced Reporting | 2,000 users | 2 (high) | 50% | 2 months | 1,000 |

---

### Example 5: Quarterly Roadmap (Phase 4)

**Timeline-Based:**
```
Q1 2026 (Now - Committed):
├─ Guided Onboarding (Retention)
├─ Enterprise SSO (Acquisition)
└─ Mobile-Optimized Workflows (Engagement)

Q2 2026 (Next - High Confidence):
├─ Advanced Reporting (depends on Data Pipeline, Q1)
├─ Slack Integration (Engagement)
└─ Pricing Page Redesign (Acquisition)

Q3 2026 (Later - Lower Confidence):
├─ Mobile App (depends on API Redesign)
├─ AI-Powered Recommendations
└─ Multi-Language Support

Q4 2026 (Exploration):
├─ Marketplace/Plugin Ecosystem
└─ Enterprise Onboarding Concierge
```

**Now/Next/Later Format:**
```
NOW (Current Quarter):
- Guided Onboarding
- Enterprise SSO
- Mobile-Optimized Workflows

NEXT (Following Quarter):
- Advanced Reporting
- Slack Integration
- Pricing Page Redesign

LATER (Future):
- Mobile App
- AI Recommendations
- Multi-Language Support
```

---

### Example 2: Bad Roadmap Planning (Feature List)

**Context:** PM creates roadmap alone, based on stakeholder requests.

**Phase 1 - Gather Inputs:** Skipped (no business goals reviewed)

**Phase 2 - Define Epics:** Listed features requested by sales, marketing, CS

**Phase 3 - Prioritize:** Prioritized by "who shouted loudest"

**Phase 4 - Sequence:** Threw features into Q1, Q2, Q3 with no rationale

**Phase 5 - Communicate:** Presented feature list to execs

**Why this failed:**
- No strategic narrative ("Why are we building this?")
- No customer problems framed
- No hypotheses or success metrics
- Roadmap felt like random feature list

**Fix with roadmap planning workflow:**
- **Phase 1:** Review business goals (reduce churn, increase enterprise)
- **Phase 2:** Turn feature requests into epics with hypotheses
- **Phase 3:** Prioritize by RICE (impact + effort), not politics
- **Phase 4:** Sequence logically by dependencies, business goals
- **Phase 5:** Present with narrative: "Q1 = Retention, Q2 = Enterprise Expansion"

---
