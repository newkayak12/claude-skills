# PRD Development — Phase Examples

Worked examples for each phase of the PRD workflow. Reference these when drafting each section.

---

## Phase 2 Example: Problem Statement

```markdown
## 2. Problem Statement

### Who has this problem?
Non-technical small business owners (solopreneurs, 1-10 employees) who sign up for our SaaS product.

### What is the problem?
60% of users abandon onboarding within the first 24 hours because they don't know what to do first. They see an empty dashboard with no guidance, get overwhelmed by options, and leave.

### Why is it painful?
- **User impact:** Wastes time (30-60 min trying to figure out product), never reaches "aha moment," churns before experiencing value
- **Business impact:** 60% activation rate → high churn, low LTV, poor word-of-mouth

### Evidence
- **Interviews:** 8/10 churned users said "I didn't know what to do first" (discovery interviews, Feb 2026)
- **Analytics:** 60% of signups complete 0 actions within 24 hours (Mixpanel, Jan 2026)
- **Support tickets:** "How do I get started?" is #1 support question (350 tickets/month)
- **Customer quote:** "I logged in, saw an empty dashboard, and thought 'now what?' I gave up and went back to my spreadsheet."
```

---

## Phase 3 Example: Target Users & Personas

```markdown
## 3. Target Users & Personas

### Primary Persona: Solo Entrepreneur Sam
- **Role:** Freelance consultant, solopreneur
- **Company size:** 1 person (no IT support)
- **Tech savviness:** Low (uses email, spreadsheets, basic SaaS)
- **Goals:** Get value from software fast without technical expertise
- **Pain points:** Overwhelmed by complex UIs, no time to watch tutorials, needs immediate value
- **Current behavior:** Signs up for products, tries for 1 day, churns if not immediately useful

### Secondary Persona: Small Business Owner (5-10 employees)
- **Role:** Owner-operator, manages team
- **Needs:** Onboard team members quickly
- **Differs from primary:** More tolerant of complexity, willing to invest setup time
```

---

## Phase 5 Example: Solution Overview

```markdown
## 5. Solution Overview

We're building a **guided onboarding checklist** that walks new users through core workflows step-by-step when they first log in.

**How it works:**
1. User signs up and logs in for the first time
2. Modal appears: "Let's get you set up! Complete these 3 steps to get started."
3. Checklist shows:
   - ☐ Create your first project
   - ☐ Invite a teammate (optional)
   - ☐ Complete a sample task
4. As user completes each step, checklist updates with checkmarks
5. After completion, celebration modal: "You're all set! Here's what to do next."

**Key features:**
- Minimal: Only 3 core steps (not overwhelming)
- Dismissible: Users can skip if they prefer to explore
- Progress tracking: Visual progress bar (1/3, 2/3, 3/3)
- Celebration: Positive reinforcement when complete
```

---

## Phase 6 Example: Success Metrics

```markdown
## 6. Success Metrics

### Primary Metric
**Activation rate** (% of users completing first action within 24 hours)
- **Current:** 40%
- **Target:** 60%
- **Timeline:** Measure 30 days after launch

### Secondary Metrics
- **Time-to-first-action:** Reduce from 3 days to 1 day
- **Onboarding checklist completion rate:** 80% of users complete all 3 steps
- **Support tickets:** Reduce "How do I get started?" tickets from 350/month to 175/month

### Guardrail Metrics
- **Sign-up conversion rate:** Maintain at 10% (don't add friction to signup)
```

---

## Phase 7 Example: User Stories & Requirements

```markdown
## 7. User Stories & Requirements

### Epic Hypothesis
We believe that adding a guided onboarding checklist for non-technical users will increase activation rate from 40% to 60% because users currently drop off due to lack of guidance.

### User Stories

**Story 1: Display onboarding checklist on first login**
As a new user, I want to see a guided checklist when I first log in, so I know what to do first.

**Acceptance Criteria:**
- [ ] When user logs in for the first time, modal appears with checklist
- [ ] Checklist shows 3 steps: "Create project," "Invite teammate," "Complete task"
- [ ] Modal is dismissible (close button)
- [ ] If dismissed, checklist doesn't reappear (user preference saved)

**Story 2: Track checklist progress**
As a new user, I want to see my progress as I complete checklist steps, so I feel a sense of accomplishment.

**Acceptance Criteria:**
- [ ] When user completes step 1, checkmark appears next to "Create project"
- [ ] Progress bar updates (1/3 → 2/3 → 3/3)
- [ ] Checklist persists across sessions (if user logs out and back in)

**Story 3: Celebrate checklist completion**
As a new user, I want to receive positive feedback when I complete the checklist, so I feel confident using the product.

**Acceptance Criteria:**
- [ ] When user completes all 3 steps, celebration modal appears
- [ ] Message: "You're all set! Here's what to do next: [suggested next actions]"
- [ ] Confetti animation (optional, nice-to-have)
```

---

## Phase 8 Example: Out of Scope & Dependencies

```markdown
## 8. Out of Scope

**Not included in this release:**
- **Advanced onboarding personalization** (e.g., different checklists per persona) — Adds complexity, test simple version first
- **Video tutorials embedded in checklist** — Resource-intensive, validate checklist concept first
- **Gamification (badges, points)** — Nice-to-have, focus on core workflow guidance

**Future consideration:**
- Mobile-optimized onboarding (desktop-first for now)

## 9. Dependencies & Risks

### Dependencies
- **Design:** Wireframes for checklist UI (ETA: Week 1)
- **Engineering:** No technical dependencies (uses existing modals framework)

### Risks & Mitigations
- **Risk:** Users dismiss checklist immediately, never see it
  - **Mitigation:** Track dismissal rate; if >50%, iterate on messaging or timing
- **Risk:** Checklist steps are too generic, don't resonate with all personas
  - **Mitigation:** Start with primary persona (Solo Entrepreneur Sam), personalize later

## 10. Open Questions

- Should checklist be mandatory or optional? (Decision: Optional, dismissible)
- Should we A/B test checklist vs. no checklist? (Decision: Yes, show to 50% of new users)
- What happens if user completes steps out of order? (Decision: Allow any order, update checklist dynamically)
```
