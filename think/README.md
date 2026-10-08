# think

**English** · [한국어](KOR.md)

Skills for the thinking that happens before the work: generating options instead of settling on the
first one, questioning whether the problem is even stated correctly, attacking your own plan hard
enough that reality can't do it first, and preparing a negotiation before you walk in. `mentor` is
the entry point when the question is about your own judgment rather than a deliverable, in any
field; the rest stand alone.

## Install & Uninstall

```bash
/plugin install think@newkayak12-claude-skills
/plugin uninstall think@newkayak12-claude-skills
```

> **trophy rides along.** From this version, the first interactive session after you install or update this plugin installs [trophy](../trophy/README.md) (achievements) once, in user scope, if you don't have it. Nothing is sent until you say yes; uninstalling trophy is respected (it is never reinstalled). To opt out beforehand: `mkdir -p ~/.claude/plugins/.newkayak12-trophy-ride.done`. Needs `sh` (Windows without one is not covered).

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Get a senior mentor's judgment in any field — career, craft, work, study, relationships, life decisions | `mentor` |
| Design something when the solution shape is still unclear | `brainstorming` |
| Have a plan I already hold interrogated before building | `grill` |
| Check whether I'm even solving the right problem | `redefine-problem` |
| Break an approach down to what's checkable and rebuild from there | `back-to-basics` |
| Have my plan attacked with the strongest objections | `devils-advocate` |
| Turn scattered notes into a structure I can write or present from | `untangle-thoughts` |
| Have counsel on my side for a salary talk, a contract, or a hard conversation | `negotiate` |

## Skills

### `mentor`

A mentor for any field — career, engineering craft, work, study, working relationships, life
decisions. It takes a position and tests yours, which is what separates it from a counselling persona
(no position) and from a tradeoff comparison (`cognition:tradeoff-articulator`, which scores options
against criteria). The first move is classification, because most questions arrive misfiled — a
values question in a decision costume, a fear described as a constraint, an inherited standard
treated as a fact:

| What you bring | What it usually is |
|---|---|
| "A인가 B인가" | a values question wearing a decision costume |
| "어쩔 수 없었어" | a choice being described as a constraint |
| "해야 하는데 못 하겠어" | a fear, or a goal that was never yours |
| "이게 맞나?" about a standard | an inherited standard, never audited |
| a confident plan | a decision already made, seeking cover |
| pain rather than judgment | not a judgment question — it stops examining and listens |

```
승진 제안을 받았는데 다들 받으라고 해. 답이 아니라 이 질문 자체를 좀 따져줘.
왜 찜찜한지 내가 모르겠어.
```

Fifteen moves, drawn from philosophical practice — elenchus, distinction, dichotomy of control,
bad faith, genealogy, impartial spectator, phronesis, via negativa, steelman, aporia, plus five
absorbed from the retired `self` plugin (ranking under scarcity, avoidance inversion, owning the
motive, role vs person, projection check) — applied one or two at a time, never as a tour, and never
named out loud (`references/moves.md` carries a worked exchange for each). The technique stays
invisible; a skill it hands over to is always named.

What separates it from a wise-sounding prose generator is a set of refusals: no aphorism or
quotation as a conclusion, no three-option menu, no abstraction without one particular from your own
account under it, no flattery, and no repetition of the hard thing once it has been said exactly
once. Aporia is an allowed outcome — ending in confusion sharper than the confusion you arrived
with beats a tidy conclusion you don't own. It routes across the whole repo (`cognition:` for
premises and grounds, `self:` for values and avoidance, `leadership:`/`portfolio:` for career
questions). Career and technical questions stay with it — it examines the judgment and hands only the
facts (benchmarks, spec comparisons, implementation) to `develop:`/`planning:`, named.

Closing shape, when the conversation reaches one:

```text
[내 생각] 한 문장, 완충 없이
[가장 강한 반론] 내 입장에 대한 것, 내가 직접 세운다
[뒤집힐 조건] 무엇을 보면 내가 틀렸다고 인정할지
[멈출 것 하나] 더할 것이 아니라 뺄 것
[다음에 알아볼 것] 답이 아니라 규칙
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
`write:plans`, never to an implementation skill.

Output shape:

```text
[맥락] what exists, which pattern the design must follow
[문제] one sentence, confirmed with you
[옵션] 3–5, no verdicts yet
[기준] kill-criteria filled in for this decision
[후보] 2–3 survivors + one trade-off table
[설계] architecture · components · data flow · errors · tests → approval → write:plans
```

### `grill`

Interrogates a plan you already hold, before anything is built. It reads the README and the code the plan touches
first: facts get looked up, only decisions are asked. The whole open frontier comes in one numbered round, each
question with a recommended answer and a one-line why; the next round asks only what your answers opened, at most
three rounds, then whatever is left is listed as open. Not a `brainstorming` mode — that skill asks one question
at a time and diverges on options; this one presses on a plan. One vague question to sharpen goes to
`cognition:question-upgrader`.

```
새 기능 설계하기 전에 나 좀 빡세게 질문해줘 — 알림 기능 추가하려고
```

On a small app whose README states its stack, scale and mail provider, a run without this skill opened no files
and asked 18–22 generic questions, some answered by the README, none with a recommendation; with it, both runs
read the README first, listed what it settled as known, and asked 7–8 questions, each with a recommended answer.

### `redefine-problem`

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

### `back-to-basics`

Breaks an approach down to a checkable floor, rebuilds from it, and states the conditions under which
the rebuild is wrong. Every assumption is listed first, then pushed through "why?" until it ends in
something checkable and sorted as `checked`, `inherited`, or `unverified` — "that's how it's done" is
a finding, not a floor. The rebuild uses only what survived, names what it gives up, and may come out
identical to today's approach, which means the constraints were real. It questions the approach and
its constraints; `redefine-problem` questions the problem statement, and `devils-advocate` does the
full counterargument work on the rebuild. Reserve it for novel situations and large bets — it's
overkill for routine decisions.

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

### `untangle-thoughts`

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

### `negotiate`

Counsel on your side: it acts like the lawyer and negotiator you don't have, and prepares before the
conversation rather than improvising in it. Four steps — case prep (counterpart's interests, your
BATNA and walk-away line, tradeables), terms review (clauses sorted into missing, risky, negotiable,
top asks ranked), strategy with exact lines to say, and a concession order in which every give is
traded for something. The BATNA is settled before any strategy, and it will not invent a competing
offer for you.

```
연봉 협상을 앞두고 있어. 시장가보다 낮게 받고 있는 상황이고
매니저는 예산이 묶여 있다고 말해. 어떻게 접근해야 할지 준비해줘.
```

Voss techniques (accusation audit, mirroring, labeling, calibrated questions) are tools for the
conversation itself; the Ackerman ladder — 65 % → 85 % → 95 % → 100 %, with a precise final number and
a non-monetary add-on — applies to money only. Output keys: CASE, TERMS, OPEN, SAY, CONCEDE, CHECK.
Not legal advice; have a lawyer read any binding contract before signing.

## MCP

| Skill | Recommended | Optional |
|---|---|---|
| `mentor` | think-tool (classifying what kind of question it is) | sequential-thinking, mcp-reasoner |
| `brainstorming` | — | think-tool, sequential-thinking, mcp-reasoner |
| `grill` | — | think-tool |
| `redefine-problem` | think-tool (required gate: assumption enumeration) | sequential-thinking |
| `back-to-basics` | think-tool (assumption listing, checked vs inherited) | mcp-reasoner |
| `devils-advocate` | — | think-tool, mcp-reasoner, sequential-thinking |
| `untangle-thoughts` | think-tool (gap surfacing) | sequential-thinking |
| `negotiate` | think-tool (counterpart interests, BATNA check) | sequential-thinking |

Add the remote SSE endpoints in Claude settings → MCP Servers.

## Related workflows

- `redefine-problem` first if the question itself feels wrong.
- `mentor` when the thing needing examination is your own judgment; once the question is stated
  right and a comparison is what's left, it hands over to `cognition:tradeoff-articulator`.
- After a decision, feed it into `develop:dev-quality-workflow` (engineering handoff) or
  `planning:roadmap-planning` (sequencing a product/strategy decision into a roadmap).
- `write:plans` (design review format) turns the divergence and stress-test output into a
  reviewable design doc.

---
