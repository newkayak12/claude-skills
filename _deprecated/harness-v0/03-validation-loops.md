# 03. Validation Loops

The purpose of validation is *not to defer decisions*. Write down hypotheses, confirm them true/false in the *cheapest possible way*, and based on results, decide whether to proceed to the next track or pivot.

## 3.1 Where the Two Loops Sit

- **Loop 1 — Product Hypothesis**: End of Product Track, before Tech Track begins.
  - Validates: "Is this a real problem? Does this solution create value for these people?"
- **Loop 2 — Tech Hypothesis**: End of Tech Track, before full build begins.
  - Validates: "Is it technically feasible? Can we meet the NFRs? Can it be operated?"

## 3.2 Writing Hypotheses — *Falsifiable*

A good hypothesis must be **falsifiable**. "Users will like it" is not a hypothesis.

### Template

> **We believe** that [persona] doing [behavior]
> will result in [outcome].
> **We'll know we're right** when we see [signal/metric ≥ threshold]
> within [time window].

### Examples

**Bad hypothesis**: "Our product will be useful."

**Good hypothesis**: "We believe that *backend developers working on side projects on weekends* who *click the 'show structural changes first' button on the PR review request page* will see *overall review time reduced by 30%*. We'll consider the hypothesis confirmed if *12 or more out of 20 beta users click this button at least twice per week*."

→ The threshold must be defined *in advance* to prevent post-hoc rationalization.

## 3.3 Loop 1 — Product Validation Techniques

### Sorted by Cost (Ascending)

| Technique | What | Cost | Validates |
|---|---|---|---|
| Customer Interview | Interview 5–7 people about *past behavior* (The Mom Test) | Very low | Problem existence, workaround behavior |
| Fake Door / Smoke Test | Advertise "this feature exists" → measure click-through | Low | Surface-level interest |
| Landing Page Test | Build only a signup page → measure signup rate | Low | Attractiveness of the value proposition |
| Wizard of Oz | Appears automated to the user, but humans process it behind the scenes | Medium | Behavioral value (do they actually use it?) |
| Concierge MVP | Provide the service manually to a small number of customers | Medium–high | Full value chain validation |
| Prototype | Evaluate usability with a clickable mockup | Medium | Usability, flow comprehension |

### Build–Measure–Learn — Lean Startup Loop

1. **Build**: The *minimum artifact* to test the hypothesis. Not a real product — fake door, mockup, concierge, etc.
2. **Measure**: Collect the pre-defined metric. In *analyzable form* (event logs, interview notes).
3. **Learn**: Confirm or reject the hypothesis. Enter next cycle or pivot.

### Pivot Types (Eric Ries)

- **Zoom-in**: One feature is the core — make that the product
- **Zoom-out**: One feature isn't enough — expand to a larger bundle
- **Customer segment**: Same problem, different customer group
- **Customer need**: Same customer, different problem
- **Platform**: App ↔ platform switch
- **Business architecture**: B2B ↔ B2C
- **Value capture**: Change monetization model
- **Engine of growth**: Viral vs paid vs sticky
- **Channel**: Switch distribution channel
- **Technology**: Same value, different technology (rare as a product pivot)

### Loop 1 Artifacts

- Hypothesis definition (3–5 items)
- Validation method + cost + duration
- Result data (numbers + quotes)
- Decision: proceed to next track / pivot / stop

## 3.4 Loop 2 — Tech Validation Techniques

### What to Validate — 4 Product Risks (Marty Cagan)

Cagan holds that every product has 4 types of risk:
- **Value risk**: Will users buy/use this? → Validated in Loop 1
- **Usability risk**: Can users use it? → Via prototype in Loop 1
- **Feasibility risk**: Can we build it? → **Core of Loop 2**
- **Viability risk**: Can our business sustain it? (legal, marketing, sales, finance) → Operational cost / regulatory aspects in Loop 2

### Loop 2 Techniques

| Technique | What | Validates |
|---|---|---|
| **Spike** | Exploratory code within a time box (1–3 days) | "Can this technology even do this?" |
| **POC (Proof of Concept)** | End-to-end working of one core path | Overall feasibility |
| **Prototype** (tech prototype) | Operates in a realistic environment | Integration, operability |
| **Performance benchmark** | Define load scenario + measure | NFR compliance |
| **Threat model** (STRIDE) | Check per security threat scenario | Security risk |
| **Chaos test** | Intentional fault injection | Resilience, operability |
| **Architecture review** | Peer/external reviewer feedback | Blind spot coverage |

### STRIDE — Threat Modeling

Microsoft's threat classification:
- **Spoofing**
- **Tampering**
- **Repudiation**
- **Information disclosure**
- **Denial of service**
- **Elevation of privilege**

Check all 6 for each component / data flow / trust boundary. Even a solo developer **must cover authentication boundaries and data storage boundaries**.

### Spike vs POC — Difference

- **Spike**: Code *to explore*. Thrown away. "Does Redis Streams fit our use case?"
- **POC**: Code *to prove*. Shows the core path actually runs. "Can we achieve P95 200ms under 10K concurrent users?"

Spike results must feed into an ADR — that's how *why we didn't choose that technology* gets recorded.

### Risk Assessment — Risk Register

| ID | Risk | Likelihood | Impact | Response (Avoid/Reduce/Transfer/Accept) | Trigger |
|---|---|---|---|---|---|
| R1 | DB write spike causing lock contention | M | H | Reduce: introduce async queue | 1K concurrent users reached |
| R2 | External API rate limit | H | M | Accept: caching + retry | First beta |

→ The top 5 risks must have *explicit response actions*. No action means it's a worry, not a managed risk.

### Loop 2 Artifacts

- Tech hypothesis definition (3–5 items)
- Spike/POC results (code + measurements)
- NFR benchmark results
- Threat model results
- Risk register
- Decision: proceed with build / adjust architecture / change stack / reduce scope

## 3.5 How to Keep Loops Short

**Symptom**: Validation loop stretches to *several weeks* → it gets avoided.

**Countermeasures**:
- **Time-box**: each loop has an *explicit deadline*. 7–14 days is typical. Conclude at that point even if data is sparse.
- **Maximum 5 hypotheses** — more than that blurs priorities.
- **Estimate validation cost conservatively** — even 5 interviews typically takes 2 weeks including recruiting, running, and synthesis.
- **No data is also a conclusion**: if "insufficient data" is the result, the first action of the next cycle is *data collection itself*.

## 3.6 Validation Gate Pass Criteria (Self-check)

Before moving to the next track, you must be able to answer all four in writing:

1. **Confirmed**: Which hypotheses were proven *with evidence*? (numbers + quotes)
2. **Rejected**: Which hypotheses were *rejected*? What needed to change?
3. **Unresolved**: Which hypotheses weren't validated, and *why was deferral accepted*? (risk acceptance record)
4. **Biggest risk in the next cycle**: So what is most dangerous going forward?
