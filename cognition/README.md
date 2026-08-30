# cognition

**English** · [한국어](KOR.md)

Skills for checking the quality of your own thinking before you act on it. Each one takes a
specific failure mode — the wrong question, an unexamined premise, a broken argument, a bias you
cannot see from inside, confidence the evidence does not support, a cost you never priced — and
gives it a named procedure with an output you can act on. They are deliberately separate: naming a
fallacy is not the same job as diagnosing a bias, and mixing them produces taxonomy instead of
analysis.

Most skills in this plugin work better with the `think-tool` MCP server connected, and the
judgment-heavy ones (`mental-model-toolkit`, and Steps 3 and 6 of the workflow) with
`mcp-reasoner`. Connect them under Claude settings → MCP Servers as remote SSE endpoints.

## Install & Uninstall

```bash
/plugin install cognition@newkayak12-claude-skills
/plugin uninstall cognition@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Stress-test a high-stakes decision end to end | `critical-thinking-workflow` |
| Check whether I'm even asking the right question | `question-upgrader` |
| Find the premises this plan silently rests on | `assumption-extractor` |
| Check an argument or a too-tidy story for structural errors | `fallacy-detector` |
| Find out why my judgment is skewed — and what to do about it | `bias-auditor` |
| Map what happens *after* the intended effect | `second-order-thinker` |
| Match my stated confidence to the actual evidence | `epistemic-reasoner` |
| See the full cost of the option I'm leaning toward | `tradeoff-articulator` |
| Get a different frame when the obvious solutions failed | `mental-model-toolkit` |
| Cut noise, sharpen a vague goal, or stop looping | `clarity-toolkit` |
| Understand my own characteristic thinking pattern | `thinking-style-profiler` |

## Skills

### `critical-thinking-workflow`

The entry point. Runs seven skills in order over one decision or argument: reframe the question,
surface assumptions, check structure and bias in parallel, map downstream effects, calibrate
confidence, then make the tradeoffs explicit. Use it when the request is "check this properly"
rather than one specific diagnosis. Each step has a documented skip condition, so you can start
mid-process.

```
I'm about to commit to migrating our billing service to event sourcing.
Run the full critical thinking review before I take it to the team.
```

```
[1] question-upgrader
      ↓
[2] assumption-extractor
      ↓
[3a] fallacy-detector  ──┬──  [3b] bias-auditor   (parallel)
                         ↓
[4] second-order-thinker → [5] epistemic-reasoner → [6] tradeoff-articulator
```

Tell it where you are — "assumptions are already done, start from second-order effects" — and it
picks up from that step. Estimated 1–3 hours for the full run, 15–30 minutes per step.

### `question-upgrader`

Runs the meta-question check *before* upgrading: is this the right question, what assumption is
embedded in it, what would change if you had the answer, and what question are you avoiding. Then
applies upgrade moves — conditional, diagnosis, scope, inversion — to produce one to three
stronger formulations. Not for questions that are already well-formed, or plain factual lookups.

```
"Should we adopt microservices?" — that's what leadership is asking.
Upgrade it before I write the answer.
```

Output always includes: what makes the question weak, the hidden assumption, the upgraded
questions with why each unlocks better thinking, and the question you might be avoiding.

### `assumption-extractor`

Scans four categories in parallel — factual, causal, value, definitional — and classifies each
assumption by load: load-bearing (the argument collapses), significant (needs substantial
revision), peripheral (details change). Then names the single most dangerous one: load-bearing with
the lowest current verification. Not for logical structure errors (`fallacy-detector`) or
overconfidence diagnosis (`bias-auditor`).

```
Here's our Q3 plan to double activation by improving onboarding.
What are we taking for granted, and which of those would sink the whole thing?
```

```
핵심 위험 전제 / Most Dangerous Assumption:
[The load-bearing assumption with lowest current verification]
If wrong: [Consequence for the plan]
To verify: [What would need to be checked]
```

### `fallacy-detector`

Two separate scans. First logical fallacies across structural (false dichotomy, slippery slope,
circular reasoning, straw man), authority/social (ad hominem, appeal to authority, bandwagon), and
causal (post hoc, cum hoc, hasty generalization) categories. Then a distinct narrative-fallacy scan
for hindsight coherence, single-cause attribution, character-driven causation, omitted
counterfactuals, and too-clean emotional arcs. It flags only what is actually present, and says so
when nothing is.

```
This is the postmortem for last quarter's churn spike. It reads a little too neatly —
one cause, one villain. Check the reasoning and the story separately.
```

Naming a fallacy without explaining which step it invalidates is taxonomy, not analysis — so every
finding says where it appears and what it weakens, ending with the single most damaging error.

### `bias-auditor`

Three scan layers — judgment biases, attribution errors, metacognitive accuracy — but the point is
what comes after. Step 2 probes the context that induces bias (time pressure, sunk investment, a
recent vivid event, evaluating someone else), Step 6 prescribes a concrete remedy per bias, and
Step 7 forces calibration by betting odds, base rate, and one piece of contrary evidence. Naming a
bias without a remedy has zero effect. Not for argument structure (`fallacy-detector`) or
quantitative confidence calibration (`epistemic-reasoner`).

```
I've decided not to renew this contractor. I'm quite sure it's the right call —
audit how I got there.
```

| Bias | Remedy it prescribes |
|---|---|
| Confirmation bias | Write down what evidence would appear if this conclusion were wrong |
| Availability heuristic | Find the base rate — long-run frequency, not the recent event |
| Anchoring | Get one independent estimate from another source; use the midpoint |
| Sunk cost | "If this were starting fresh today, would I start it?" |
| Planning fallacy | Reference-class forecasting — actual duration of 3 similar tasks |

### `second-order-thinker`

Maps first-order effects, then checks all five second-order mechanisms without skipping:
behavioral responses to changed incentives, feedback loops, resource and attention effects,
signaling, and competitive responses. Every effect gets a time label — immediate, medium-term,
long-term — because "short-term gain, long-term cost" is the pattern most often missed. Stops at
third order unless the case warrants more.

```
We're about to pay a bonus for closed support tickets. First order is obvious.
What happens six months in?
```

The output names one critical effect with its time horizon and, crucially, a leading indicator to
watch for so you can tell whether it is actually materializing.

### `epistemic-reasoner`

Two instruments. Calibration labels each claim with the confidence the evidence actually warrants
— high / moderate / low / speculation — and names the gap from your stated confidence. Analogy
testing splits a comparison into source and target domain, marks which mappings hold and which
break, then asks whether the conclusion depends on the broken part. Run calibration first when both
apply. Not for diagnosing *why* you're overconfident (`bias-auditor`).

```
I keep telling the board "this is obviously the next AWS." Test that analogy,
and tell me how confident I'm actually entitled to be.
```

Ships two subagents: `epistemic-labeler` for calibration and `analogy-tester` for the comparison
work.

### `tradeoff-articulator`

Finds the axes you did not name — reversibility, optionality, cognitive load, risk variance, and
who actually pays — then builds a qualitative matrix (no false-precision scores), states
opportunity costs concretely, and names the axis pair where the tension is unavoidable. It does not
resolve the conflict and does not recommend an option unless you ask.

```
Managed Postgres versus running our own on EC2. Everyone says managed is
obviously right — map what we'd be giving up.
```

```
Option    | Speed | Cost | Reversibility | Cognitive Load | Risk
Option A  |  +++  |  --  |     high      |      low       | low variance
Option B  |   +   |  +   |     low       |      high      | high upside
```

Opportunity costs are stated in specifics: not "giving up some flexibility" but "giving up the
ability to switch databases without a full rewrite, ~3–6 weeks in year 2".

### `mental-model-toolkit`

Diagnoses which of three instruments fits before applying any of them: the mental model library
(First Principles, Inversion, Map vs Territory, Occam's Razor, Pareto, Regret Minimization,
Chesterton's Fence), the unknown-unknowns mapper (pre-mortem, red teaming, outsider perspective,
assumption audit, perspective expansion), or the lateral thinking prompter (Random Entry,
Provocation, Reversal, Analogical Thinking, Constraint Removal). Not for consequence chains
(`second-order-thinker`) or systematic assumption audits (`assumption-extractor`).

```
We've tried three different retention experiments and none moved the number.
Give me a frame I haven't looked at this from.
```

Full catalogs live in `references/mental-models-catalog.md` and
`references/lateral-thinking-techniques.md`.

### `clarity-toolkit`

Diagnoses the mode first, then applies exactly one. Signal/Noise filters information by
actionability, source quality, recency, and relevance into a MUST KNOW / GOOD TO KNOW / NOISE
stack. Vagueness Eliminator rewrites a goal until two people could independently tell whether it
was met. Overthinking Detector names the looping pattern and applies a circuit breaker — 10/10/10,
reversibility, minimum viable answer. Not for choosing between well-defined options
(`tradeoff-articulator`).

```
My manager said my goal this half is "be more strategic". I have no idea what
I'm supposed to do differently on Monday.
```

Every run ends with one concrete step you can take in the next hour.

### `thinking-style-profiler`

Profiles you across five dimensions — systems vs detail, convergent vs divergent, abstract vs
concrete, intuitive vs analytical, sequential vs non-linear — then matches learning and working
strategies to the result. It asks one or two diagnostic questions at a time rather than
administering all five at once, and treats style as contextual and developable, not as a fixed
type. Not for simple study tips or bias diagnosis.

```
Collaborative sessions leave me flat but three hours alone with a hard problem
energizes me. Help me name what my thinking actually does.
```

Output: profile summary, strengths, characteristic risk zones, top three matched strategies, and
one developmental focus to actively practice.

---
