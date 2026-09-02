# think

**English** · [한국어](KOR.md)

Skills for the thinking that happens before the work: generating options instead of settling on the
first one, questioning whether the problem is even stated correctly, attacking your own plan hard
enough that reality can't do it first, and converging on a decision with criteria rather than a gut
feel. `deep-thinking-workflow` is the entry point when you want the whole sequence; the rest stand
alone.

## Install & Uninstall

```bash
/plugin install think@newkayak12-claude-skills
/plugin uninstall think@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Run the whole idea → decision process end to end | `deep-thinking-workflow` |
| Design something when the solution shape is still unclear | `brainstorming` |
| Check whether I'm even solving the right problem | `problem-reframer` |
| Strip inherited assumptions and rebuild from the ground up | `first-principles` |
| Have my plan attacked with the strongest objections | `devils-advocate` |
| Turn scattered notes into a structure I can write or present from | `thought-organizer` |
| Design a UI moment — toggle, loading state, empty state — that feels right | `microinteractions` |
| Prepare for a salary talk, a contract, or a hard conversation | `negotiation` |

## Skills

### `deep-thinking-workflow`

The entry point. Four steps — diverge → decompose → challenge → converge — driving three other
skills in order and then a decision matrix:

| Step | Skill | Output | Skip if |
|---|---|---|---|
| 1. Diverge | `brainstorming` | 3–5 options, cut to 2–3 finalists against written kill-criteria | Ideas already exist |
| 2. Decompose | `first-principles` | Root causes, components, assumption list | Scope already well-defined |
| 3. Challenge | `devils-advocate` | 3 strongest counterarguments + core vulnerability | Low-stakes or reversible |
| 4. Converge | (decision framework) | Weighted decision matrix, recommendation, confidence | One option left standing |

Step 4 lists the 2–4 surviving options, names 3–5 weighted criteria, scores each, and states the
recommendation, the confidence level, and what would change the call. You can join mid-process —
say which step you're at and it starts there. Skip it for a simple factual question or when you
already know what to do.

```
사내 결제 시스템을 직접 만들지 외부 PG를 쓸지 결정해야 해.
아이디어 발산부터 반론까지 다 돌리고 마지막에 비교표로 정리해줘.
```

### `brainstorming`

Turns an idea into a design, with divergence and convergence explicitly separated: quantity rules the
first half, criteria rule the second. It gates implementation — no code, scaffolding, or
implementation-skill calls until the design is approved, even for "simple" projects. Design output
means diagrams, component descriptions, data-model tables, trade-off comparisons; API signatures,
library calls, and runnable pseudocode mean you've already left design.

```
알림 시스템을 새로 만들어야 해. 이메일/푸시/인앱을 하나로 묶고 싶은데
어떤 구조가 가능한지 옵션부터 넓게 뽑아줘.
```

Divergence tools (1–2 at a time): vanilla, constraint relaxation, SCAMPER, analogy, opposite-of —
at least three options before any judgment, including one expected to lose. Convergence is gated on
written kill-criteria — constraint violation, missing success criteria, uncontrolled dependency,
reversibility, team fit — narrowing to 2–3 options, not 1; a strong pull toward one option routes
through `cognition:bias-auditor` first. Questions come one at a time. After approval it hands off to
`write:writing-plans`, never to an implementation skill.

Output shape:

```text
[맥락] what exists, which pattern the design must follow
[문제] one sentence, confirmed with you
[옵션] 3–5, no verdicts yet
[기준] kill-criteria filled in for this decision
[후보] 2–3 survivors + one trade-off table
[설계] architecture · components · data flow · errors · tests → approval → write:writing-plans
```

### `problem-reframer`

Doubts the problem before solving it. Where `brainstorming` produces more solutions to a given
problem, this asks whether the problem is stated right. It separates symptom from mechanism ("does
this end when the state goes away, or come back wearing a different face?"), completes a hidden-
assumption table as a hard gate before any output, then applies 2–3 of seven reframing techniques —
never all seven.

```
기능을 계속 내는데 리텐션이 안 움직여. 세 가지 접근을 다 해봤는데
전부 뭔가 어긋난 느낌이야. 문제 정의부터 다시 봐줘.
```

Output shape:

```text
1. Stated problem (원문 그대로)
2. Symptom vs problem — 증상 / 메커니즘 가설 / 우리가 다룰 것
3. Hidden assumptions — | Assumption | Why it might be false | Confidence |
4. Reframed versions — 2-4개, 각 한 문장
5. Most promising reframe + why
6. Unlocking question — 답이 나오면 접근이 가장 크게 바뀔 단 하나의 질문
```

A reframe that doesn't change your approach is a paraphrase, not a reframe.

### `first-principles`

Decomposes a claim to irreducible truths and rebuilds from them, through three lenses: **A**
Aristotelian decomposition (keep asking "why?" until the chain ends in physics, logic, or verified
data — "we've always done it this way" is never a first principle), **B** practical reconstruction
(Musk/Munger — rebuild from raw inputs, invert, trace second-order effects, name opportunity cost),
and **C** synthesis and challenge (which assumptions survived A, which new ones B introduced, and
under what conditions the reconstruction is wrong). It self-scores 0–10 and states what's missing to
reach 10. Reserve it for novel situations and large bets — it's overkill for routine decisions.

```
우리 배포가 왜 2주 걸려야 하는지 처음부터 다시 따져줘.
물리적으로 필수인 단계랑 관행으로 남은 단계를 분리하고 싶어.
```

### `devils-advocate`

Produces the strongest objections against a position — steel-manned, specific to this proposal, never
hedged and never balanced. Three counterarguments by default, fewer if only fewer are real (it never
pads to a count), each labeled with type (`structural` / `assumption` / `execution` / `timing`),
severity, and a real precedent — or an honest "no clear precedent — speculative concern" rather than
a fabricated one. It hunts unstated assumptions first, since the sharpest objection usually targets
one of them, and always closes with one core vulnerability and a reversibility call — that line is
what tells you whether the objections must be resolved before starting or can be learned after.

```
모놀리식을 MSA로 쪼개자는 제안이야. 가장 강한 반론 세 개랑
그중 진짜 치명적인 게 뭔지 짚어줘.
```

Output shape:

```text
Position / Steel-man
숨은 가정 1-3
반론 1..3 — [type] · severity · 선례 (또는 "no clear precedent")
[다중 페르소나 공격 — 아키텍처·조직·GTM·정책 결정일 때만, 2-3명]
핵심 취약점 — 가장 눈에 띄는 문제가 아니라 가장 깊은 구조적 결함
가역성 — reversible | one-way door
```

Multi-persona attack (CFO, on-call/SRE, competitor, legal, junior, customer) is skipped for narrow
technical choices — a regulatory critique of "Redis vs Memcached" is theater. Path-forward
suggestions only appear if you ask for improvement rather than critique.

### `thought-organizer`

Takes scattered notes, half-formed ideas, and stream-of-consciousness and produces structure: absorb
→ extract atoms → cluster → rank → structure → surface gaps → deliver. It preserves your intent
rather than imposing a narrative, adds no ideas you didn't express, and always flags contradictions
and open questions instead of smoothing them over. Output starts with the structure — never with a
summary of your input read back to you.

```
독서 기록 앱 만들고 싶은데 생각이 산만해. 소셜 기능도 넣고 싶고
혼자 쓸 수도 있어야 하고. 아웃라인으로 정리해줘.
```

It picks the output shape before structuring:

| Situation | Technique |
|---|---|
| Goal is a document, essay, or presentation | Outline |
| You say "map", or input has no clear hierarchy | Text mind map |
| 5+ ideas with named cross-links, knowledge-base goal | Zettelkasten-style linking |
| You need only the core message | Core claim extraction |

### `microinteractions`

Designs the contained product moments — toggles, password fields, loading indicators,
pull-to-refresh, like buttons — using Dan Saffer's structure: Trigger, Rules, Feedback, Loops &
Modes, plus signature moments and reduction. Trigger → feedback → rules gets defined before any
motion is designed, animation duration matches the perceived weight of the action, and no motion is
added as decoration — every one communicates a state change. It self-scores 0–10 with the gaps named.

```
파일 업로드 버튼이 눌러도 반응이 없는 것처럼 느껴져.
트리거부터 성공 피드백까지 어떻게 설계해야 할지 잡아줘.
```

Each area carries an ethical boundary: no critical triggers hidden behind gestures without a visible
fallback, no fake progress bars or manipulative countdowns, no adaptive loops that make opt-out
progressively harder, and function always before delight.

### `negotiation`

Chris Voss's tactical-empathy framework, prepared before the conversation rather than improvised in
it: tactical empathy, mirroring, labeling, calibrated questions, accusation audit, "That's right",
Ackerman bargaining, and Black Swans. Identify your BATNA before entering; prepare at least two black
swans; anchor on interests rather than positions; never treat the first offer as the floor. It
self-scores 0–10 against those moves.

```
연봉 협상을 앞두고 있어. 시장가보다 낮게 받고 있는 상황이고
매니저는 예산이 묶여 있다고 말해. 어떻게 접근해야 할지 준비해줘.
```

Ackerman ladder: open at 65 % of target, then 85 % → 95 % → 100 %, with a precise non-round final
number and a non-monetary bonus attached. Every technique carries an ethical boundary — empathy to
understand rather than manipulate, black swans to improve both sides' outcome rather than exploit
private information.

## MCP

| Skill | Recommended | Optional |
|---|---|---|
| `deep-thinking-workflow` | think-tool, sequential-thinking | mcp-reasoner |
| `brainstorming` | — | think-tool, sequential-thinking, mcp-reasoner |
| `problem-reframer` | think-tool (required gate: assumption enumeration) | sequential-thinking |
| `first-principles` | think-tool (Lens A and Lens C) | mcp-reasoner |
| `devils-advocate` | — | think-tool, mcp-reasoner, sequential-thinking |
| `thought-organizer` | think-tool (gap surfacing) | sequential-thinking |
| `microinteractions` | — | think-tool |
| `negotiation` | think-tool (counterpart motivations, black swans) | sequential-thinking |

Add the remote SSE endpoints in Claude settings → MCP Servers.

## Related workflows

- Before Step 1, `problem-reframer` if the question itself feels wrong.
- After a decision, feed it into `pm:pm-strategy-workflow` or `develop:dev-quality-workflow`.
- `technique-write:design-review-writer` turns the divergence and stress-test output into a
  reviewable design doc.

---
