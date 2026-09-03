# write

**English** · [한국어](KOR.md)

Writing skills for the things engineers actually have to write: design docs and PRDs, implementation
plans, blog posts, peer feedback, and the SKILL.md files that drive other skills. Each one is a
process rather than a prompt — context first, structure second, prose last — and two of them
(`writing-plans`, `writing-skills`) are harness-aware: the same skill produces a document when you
run it alone, and a machine-readable spec when a `harness:harness` run is driving.

## Install & Uninstall

```bash
/plugin install write@newkayak12-claude-skills
/plugin uninstall write@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Co-write a substantial doc (PRD, design doc, RFC) that others will read | `doc-coauthoring` |
| Plan a multi-step implementation before touching code | `writing-plans` |
| Write or fix a SKILL.md | `writing-skills` |
| Write a technical blog post about something I built or fixed | `technical-blog-writer` |
| Give a colleague feedback that lands instead of stinging | `sbi-writer` |
| Review text, or draft a PR description / post that reads as human-written | `writer-verification` |

Knowledge-base, knowledge-graph, RAG corpus, and knowledge-query skills now live in the `knowledge`
plugin.

## Skills

### `doc-coauthoring`

A three-stage workflow for a document someone else will read: **Context Gathering** (info dump plus
5–10 numbered clarifying questions), **Refinement & Structure** (one section at a time — questions →
5–20 brainstormed options → you curate → draft → surgical edits), and **Reader Testing** (a fresh
Claude with no authoring context answers predicted reader questions and exposes blind spots). It
never drafts all sections upfront and never starts before it knows who the primary reader is.

```
새 검색 서비스 design doc 같이 쓰자. 독자는 인프라 팀이고,
왜 Elasticsearch 대신 직접 인덱싱하는지 설득해야 해.
```

Per document it produces: the document structure, the drafted sections, review comments on clarity
and gaps, and a revision log. In Claude Code, Reader Testing runs the `agents/reader-agent.md`
subagent; on claude.ai it falls back to `references/manual-reader-testing.md`.

### `writing-plans`

Produces implementation plans — and never runs them. The gap check and ambiguity check that
`planning:executing-plans` would otherwise do at hand-off happen here, at production time: every
step gets one observable pass bar stamped on it before the plan counts as finished. Staleness/drift
is deliberately out of scope; `planning:executing-plans` owns that check.

```
결제 웹훅 재시도 로직 구현 계획 써줘. 기존 PaymentEventHandler 건드리는 범위까지 포함해서,
태스크마다 어떤 테스트가 통과해야 끝인지 명시해줘.
```

**Dual-mode.** The same process has two output shapes:

| Mode | Produces | Consumed by |
|---|---|---|
| Solo | Plan doc at `docs/plans/YYYY-MM-DD-<feature>.md`, pass bar per step | `completion:verification-before-completion` |
| Harness-engaged | A SetGoal goal-spec — subgoals with `acceptance[]` / `test[]` | The harness QualityGate, subgoal then goal level |

Per-task shape in solo mode:

```markdown
### Task N: [Component]
**Files:** create/modify/test — exact paths.
**Interfaces:** consumes [earlier tasks' signatures] / produces [names later tasks rely on].
**Pass bar:** [the one observable check proving the step is done]

- [ ] 1: failing test (full code) → 2: confirm it fails → 3: minimal implementation
  (full code) → 4: confirm it passes → 5: commit
```

### `writing-skills`

Authors convention-compliant `SKILL.md` files and refuses to grade its own output — trigger coverage
goes to `skill:skill-trigger-validator` and the pre-ship pass to `skill:skill-quality-assurance`. It
borrows the TDD shape for prose: name a scenario where an agent misbehaves *without* the skill,
confirm the miss is a real gap, then write the smallest draft that closes it. No confirmed gap, no
draft.

```
harness 실행 로그에서 실패 원인 요약하는 패턴을 skill로 만들어줘.
description이 "Use when"으로 시작하게 하고, 트리거 검증까지 돌려줘.
```

**Dual-mode.** The same four moves, two lanes:

| Move | Solo | Harness-engaged |
|---|---|---|
| Scope the gap | You name the miss from memory or a manual probe | SetGoal's acceptance criteria already state it |
| Draft | You write the SKILL.md | An Implement executor writes it against the subgoal bar |
| Trigger check | You invoke `skill:skill-trigger-validator` | QualityGate invokes it while scoring the subgoal |
| Ship gate | You invoke `skill:skill-quality-assurance` and act on its report | QualityGate invokes it; a failing report blocks the subgoal |

If a harness pipeline handed you the task, act in harness-engaged mode; otherwise default to solo and
run both gates yourself. Shipping also means bumping the plugin version in
`.claude-plugin/marketplace.json`, updating that plugin's README, and re-running
`scripts/validate_plugins.py`.

### `technical-blog-writer`

Three phases: extract the core story (what you built, what was surprising, what a reader would do
differently — no draft until all three have answers), outline against the fixed arc, then draft and
polish. The arc is Hook → Problem in Depth → Solution → Results → What You'd Do Differently →
Conclusion + CTA, and the solution is told in the order you discovered it, not as a clean explainer.

```
Kafka consumer lag를 40초에서 2초로 줄인 과정을 기술 블로그로 쓰고 싶어.
파티션 재설계가 핵심이었고, 처음엔 컨슈머 수만 늘려서 실패했어.
```

Length guide:

| Topic type | Target |
|---|---|
| Quick tip or single concept | 400–700 words |
| Full problem/solution narrative | 1,000–1,800 words |
| Deep dive or tutorial | 2,000–3,500 words |
| Series part | 1,000–1,500 words per part |

### `sbi-writer`

Rewrites feedback into Situation → Behavior → Impact: a single specific moment, an observable action
that passes the camera test, and the actual consequence stated from "I/we". It separates observation
from judgment in the raw input and flags interpretations and character labels for rephrasing. Works
the same for praise — vague praise doesn't tell the receiver what to repeat.

```
팀원이 스프린트 리뷰에서 준비 없이 발표해서 고객 미팅이 밀렸어.
비난처럼 안 들리게 피드백 문장 만들어줘.
```

Common failures it fixes:

| Mistake | Fix |
|---|---|
| Judgment disguised as behavior ("무책임하게 행동했다") | "마감 전날 아무 공지 없이 작업을 제출하지 않았다" |
| Vague situation ("항상 회의에서") | "지난 화요일 스프린트 플래닝에서" |
| Missing impact ("그건 별로였어") | "팀이 다음 스텝을 못 정하고 하루를 낭비했다" |
| Piling on multiple behaviors | One behavior per SBI |

### `writer-verification`

Makes writing read as if a person wrote it — two modes. **Review** runs five passes over text you
already have: spelling & grammar, writing patterns, expression & style, reader perspective, and a
**humanizer** that looks only for machine tells — headers and bold labels on short text, reflex
triads, a closing that restates the opening, "This PR introduces…", em-dash chains, nobody's-voice
vocabulary (leverage, robust, seamless, "~에 있어서"), and *what without why*. **Draft** takes a
diff, branch, or outline, writes a first draft the way the author would say it to a colleague, then
runs the five passes on its own draft and rewrites until 🔴🟡 = 0 or three rounds have run — you
see only the result and a one-line note of what the loop caught.

```
이 브랜치 PR 설명 써줘. AI 티 안 나게, 사람이 쓴 것처럼.
```

PR descriptions are a first-class input (`references/pr-description.md`): why → what at the level
of behavior → where to look first and what the author is unsure about → risk/rollback, sized to
the diff — three sentences for a 40-line fix, never a file list. A PR description with no *why* is
🔴. Every finding carries original → fix + reason. Under 300 characters the passes run inline; at
300 or more they run as parallel subagents and are aggregated — deduplicated by span, conflicting
severity elevated, conflicting fixes shown with attribution.

Priorities: 🔴 Must fix (meaning errors, logic gaps, missing why) · 🟡 Recommended (patterns,
tells) · 🟢 Optional (style preference — your voice, your call).

The humanizer's false-positive rate is measured, not assumed. Eight merged PR descriptions from
cargo / flask / requests / tokio (2019–2021, pre-LLM) and four from 우아한테크코스 missions were run
blind alongside four model-written controls: every human text came back `(none)`, every control
was caught. The one noisy case — a rushed Korean PR flagged for "no example" and a "reflex triad"
that was really three things — became a *what is not a tell* section in `agents/humanizer.md`:
typos, greetings, real lists of three, and PR-template checklists are not tells, and `[why]` is
asked once of the whole text (does it say what broke? is the author unsure of anything?) rather
than of every sentence; missing reason is 🔴, missing doubt alone is 🟡, because confident people
exist. Two of the human PRs ship as fixtures so the check is repeatable (`evals/evals.json` #4).

## MCP

Every skill in this plugin lists MCP tools as optional or recommended, not required:

| Skill | Tool | Used for |
|---|---|---|
| `doc-coauthoring` | think-tool | Deciding which section holds the most unknowns |
| `writing-plans` | sequential-thinking, think-tool | Dependency chains; judging whether a step is unambiguous |
| `writing-skills` | think-tool | Framing the RED-phase pressure scenario |
| `technical-blog-writer` | think-tool | Fixing the core story and angle before drafting |
| `sbi-writer` | think-tool | Ambiguous observation-vs-judgment cases |
| `writer-verification` | think-tool, sequential-thinking, mcp-reasoner | Pass structuring; resolving conflicting findings; picking the summary lead |

Add the remote SSE endpoints in Claude settings → MCP Servers.

---
