# Situational — Self-discipline

**Trigger**: cycle is stretching / WIP exceeds 1 / release keeps being postponed / writing code instead of validating

For a solo developer, the *enemy* is not external. These are rules for keeping agreements with yourself.

## SD-01: Time-box validation loops — 7–14 days

- **Why**: When validation loops stretch to *weeks*, they get avoided. A fixed deadline forces a conclusion *one way or another*.
- **How**:
  - At cycle start, explicitly state *deadlines for each gate* (e.g. Loop 1 = 2 weeks, Loop 2 = 1 week)
  - Even with insufficient data, reach a conclusion *at that point* — "insufficient data" is also a conclusion
  - On deadline miss, *force-close to the next cycle*. Unlimited extension is not permitted.

## SD-02: Max 5 hypotheses per cycle

- **Why**: Too many hypotheses dissolve prioritization. The *depth* of validation disappears.
- **How**:
  - At cycle start, state hypotheses *explicitly at 5 or fewer*
  - When a 6th appears, *remove one existing hypothesis*
  - Removed hypotheses go into the *candidate queue for the next cycle*

## SD-03: WIP = 1 (Work In Progress limit)

- **Why**: Too many concurrent cycles or features means *none of them finish*. Context-switching cost explodes.
- **How**:
  - At most 1 cycle *in progress* simultaneously
  - *Close the current cycle* before starting a new one
  - Exception: responding to a production incident (excluded from WIP count)

## SD-04: 80% ship rule

- **Why**: The last 20% of polish takes *as long as the first 80%*. During that time, no market feedback is received. *Incomplete shipping* is often faster learning.
- **How**:
  - When the urge to refine appears: compare *what can be learned by shipping now* vs *what can be learned after finishing*
  - If DoD is met and the core hypothesis can be validated — ship
  - Polish goes into the *next cycle*

## SD-05: Polish is after cycle end, not before the next cycle begins

- **Why**: *Starting the next cycle with polish* means new learning never happens.
- **How**:
  - When the urge to polish is strong, split it into a *separate cycle* ("polish sprint" — time-limited)
  - Or *register it as debt* and handle it in the pay-down ratio of the next cycle

## SD-06: Writing code instead of validating? — self-check

- **Why**: Validation means *facing uncertainty*, which is *uncomfortable*. Writing code is *certain* and *shows progress* — it operates as an avoidance mechanism.
- **How**:
  - Self-check when coding time > interview/validation time
  - Ask: "Does writing code right now reduce *the biggest risk*?"
  - If *No* — return to validation

## SD-07: Cycle end is *explicit*

- **Why**: A *naturally concluded* cycle has no retrospective and no learning. Making closure an *event* is what makes learning stick.
- **How**:
  - Define cycle-end triggers (validation complete / deadline reached / pivot decided)
  - At close, *always* invoke `think:retrospective` ([`R-KP01`](../06-rules.md#r-kp01-retro-after-every-cycle))
  - Preserve retrospective outputs (*what was surprising, what to change next*) in a separate file

## SD-08: Check the *real reason* for postponing release

- **Why**: The real reason behind "just a little more polish" is often *fear of criticism*. Without recognizing it, release never happens.
- **How**:
  - Self-check on the *3rd occurrence* of postponing release
  - Ask: what are the *technical* reasons vs *psychological* reasons for postponing?
  - If psychological — limit exposure and ship via *restricted beta user count* ([`R-SC04`](../06-rules.md#r-sc04-intentionally-limit-beta-user-count))

## SD-09: More than 5 skill invocations in one cycle — suspect something

- **Why**: When skill invocations increase, it signals *decision paralysis* or *over-analysis of small decisions*. ([`R-AI05`](../06-rules.md#r-ai05-more-than-5-skill-calls-in-one-cycle-is-a-warning-sign))
- **How**:
  - When invocation count exceeds 5, examine — which stage is excessive?
  - Ask: "Is this decision actually worth invoking a skill for?"

## SD-10: Quarterly self-retrospective — "rules I break"

- **Why**: Observing the *pattern of rules you break* is more useful than just maintaining a list of rules.
- **How**:
  - Each quarter, list the rules broken across the *last 3 cycles*
  - For the 1–2 most frequently broken — *why* were they broken? (Is the rule unrealistic? Am I still maturing?)
  - Either *revise the rule* or add an *enforcement tool* (time-box, alarm, etc.)

## SD-11: Check "I'm different"

- **Why**: Treating general rules as *exceptions for my case* too frequently becomes a pattern.
- **How**:
  - When "our case is different" comes to mind, validate with the *outside view* ([`cognitive.md#c-11`](./cognitive.md))
  - Three consecutive "we're different" is a signal of a *rule-ignoring pattern*

## Related skills

- `think:retrospective` — cycle retrospective
- `cognition:bias-auditor` — self-awareness bias
- `pm:shape-up` — appetite-based cycles
- `self:examined-life` — deeper self-examination (outside of cycles)
- `cognition:second-order-thinker` — second-order consequences of "postponing release"
