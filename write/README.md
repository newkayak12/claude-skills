# write

**English** · [한국어](KOR.md)

Writing skills for the things engineers actually have to write: requirements breakdowns, PRDs and
design docs, ADRs and design reviews, implementation plans, blog posts, peer feedback, and the SKILL.md
files that drive other skills. Each one is a
process rather than a prompt — context first, structure second, prose last — and two of them
(`plans`, `writing-skills`) are harness-aware: the same skill produces a document when you
run it alone, and a machine-readable spec when a `harness:harness` run is driving.

## Install & Uninstall

```bash
/plugin install write@newkayak12-claude-skills
/plugin uninstall write@newkayak12-claude-skills
```

> **trophy rides along.** From this version, the first interactive session after you install or update this plugin installs [trophy](../trophy/README.md) (achievements) once, in user scope, if you don't have it. Nothing is sent until you say yes; uninstalling trophy is respected (it is never reinstalled). To opt out beforehand: `mkdir -p ~/.claude/plugins/.newkayak12-trophy-ride.done`. Needs `sh` (Windows without one is not covered).

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Split a requirement or 기획서 into items with criteria, open questions and actors | `requirements` |
| Co-write a doc others will read — PRD, design doc, RFC, proposal | `prd` |
| Record a decision as an ADR, or write a design review | `adr` |
| Plan an implementation or break it into tickets, write a technical blog post, or give feedback that lands | `plans` |
| Turn a conversation that already settled what to build into a spec — no re-interview | `spec` |
| Write or fix a SKILL.md | `writing-skills` |
| Review text, or draft a PR description / post that reads as human-written | `writer-verification` |
| Rewrite text so it sounds like *me*, learned from my own samples | `like-me` |
| Write a technical book in stages — TOC first, review loop per chapter, PDF at the end | `tech-book` |
| Draw a checked figure (SVG + PNG) for a book, doc or share — not Mermaid | `diagram` |

Knowledge-base, knowledge-graph, RAG corpus, and query skills now live in the `knowledge`
plugin.

## Skills

### `requirements`

Splits a requirement or 기획서 into checkable items — and stops there: no code, no implementation plan, no tickets. It reads all of the input, names the actors, and collects every rule with its place in the input (`inferred` when the input implies a rule but never states it). The missing exception handling (cancel, failure, duplicate, timeout, no-stock) becomes open questions, each with an assumed default and a suggested owner. Items F1, F2, … each get a one-sentence outcome and `F<n>-AC-n: Given … When … Then …` criteria numbered uniquely across the analysis, then the `plans` gap and ambiguity checks run over them. Not for a settled conversation to write down (`spec`) or a spec with acceptance and tasks before code (`develop:spec-driven-development`).

```
이 기획서 쪼개줘
```

Output has four parts — Actors, Rules, Open questions, Items — in the input's language, saved to the path the caller names, otherwise `docs/requirements/YYYY-MM-DD-<topic>.md`.

### `prd`

Writes a PRD, design doc, RFC or proposal for readers, section by section, following `references/document.md`. It detects the output format, asks who the primary reader is and what single question the document must answer, then runs the stages below.

#### Document

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

### `adr`

Records a made decision as an ADR, or explores a decision in a design review before it is made. It picks the format by the signal: decision made → ADR, options open → design review. A review that ends Approved converts to an ADR, and the two cross-link in `Related:`.

#### Design review

Drives a section-by-section interview and assembles the result into a fixed 8-section Design Review.
It never drafts all sections in one shot, requires at least two alternatives in §6, runs
`devils-advocate` against the proposed design before writing the trade-offs, and writes §1 Summary
last. Skip it for a one-line fix, or when the decision is already made — in that case it stops and
switches to the ADR format.

```
결제 모듈을 새로 만들려고 해. PG 연동이랑 정산 분리가 쟁점인데
design review 문서 같이 잡아줘.
```

Fixed section order (optional sections are only filled when you confirm they apply):

```text
Metadata → 1. Summary → 2. Background & Context → 3. Goals & Non-Goals
→ 4. Requirements (Functional / Non-Functional) → 5. Proposed Design
→ 6. Alternatives Considered → 7. Trade-offs → 8. Impact Analysis
→ Optional: Migration/Rollout · Rollback · Observability · Testing Strategy
           · Security & Compliance · Operational Concerns · Open Questions
           · Timeline & Milestones
→ Review Comments
```

Saved to `docs/design-reviews/YYYY-MM-DD-<short-slug>.md`. Once the status is Approved, it switches
to the ADR format and cross-links both documents.

#### ADR

Turns an approved Design Review — or raw decision context — into a numbered ADR. The Decision must
be declarative (`~를 채택한다`, `~로 한다`); hedging like `~를 고려한다` is rejected. Consequences
always carry all three buckets, and an empty Negative triggers `bias-auditor` rather than being left
blank. An accepted ADR is never edited or deleted: reverse it with a new ADR and mark the old one
`Superseded by ADR-XXXX`.

```
Postgres 대신 Aurora로 가기로 결정했어. docs/design-reviews/2026-03-11-storage.md
기반으로 ADR 써줘. 기존 ADR-0001을 대체하는 거야.
```

Fixed section order:

```text
# ADR-NNNN: [결정 제목]
Metadata (Status / Date / Deciders / Related)
→ Context → Decision → Rationale
→ Consequences (Positive / Negative / Neutral) → References
```

Stored at `docs/adr/NNNN-<slug>.md` with sequential numbering:

```text
docs/adr/
  0001-use-postgresql-as-primary-store.md
  0002-adopt-kafka-for-inter-service-events.md
  0007-supersede-0001-migrate-to-aurora.md
```

### `plans`

One entry for writing that starts from a plan. Step 0 reads the purpose from the request and asks only when it is ambiguous; an implementation plan is the default, so hand-offs from `think:brainstorming`, `planning:executing-plans` and the harness never get a question.

#### Implementation plan (default)

Produces implementation plans — and never runs them. The gap check and ambiguity check that
`planning:executing-plans` would otherwise do at hand-off happen here, at production time: every
step gets one observable pass bar stamped on it before the plan counts as finished. Staleness/drift
is deliberately out of scope; `planning:executing-plans` owns that check. Each task is one vertical slice — one
behaviour working end to end, never "all backend, then all frontend" — and names what blocks it, so a ticket
breakdown ("티켓으로 쪼개줘") lands here too. On a saved-search feature, a run without this rule split the work
into Backend and Frontend sections with no blocking edges; with it, two runs gave 7 and 8 slices, each carrying `Blocked by` and a pass bar.

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

#### Blog

Runs the document path with `references/examples/blog.md`.

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

#### Feedback (SBI)

Short form — `references/examples/sbi.md`, no section loop or reader testing.

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

### `spec`

Turns a discussion that already decided what to build — a thread, a meeting, a chat with PM — into a
spec, without interviewing you again. It reads the conversation, then the repo (glossary, the code and
tests the conversation names, nearby ADRs), and sorts every point into decided, deferred, or open. Open
points become `[확인 필요: …]` markers naming who decides; none is filled with a sensible-sounding
default. The spec has problem, solution, user stories (only those the conversation supports),
implementation decisions with their source, testing decisions at a named seam, out of scope, and open
questions, closing on a recountable tally. Writing a PRD or design doc from scratch with reader testing
stays with `prd`.

On a coupon conversation (percentage discounts, cap, minimum order, rounding left to finance), a run
without this skill wrote a reasonable spec in zero tool calls — it never opened the glossary or the
coupon code. With it, the run read the glossary, the coupon code and its test first, used the glossary's terms, named
the existing `applyCoupon` test as the seam, and left rounding open for finance instead of picking one.

```
방금 PM이랑 나눈 대화야. 이걸로 spec 정리해줘 — 이미 얘기한 건 다시 묻지 말고.
```

### `writing-skills`

Authors convention-compliant `SKILL.md` files and refuses to grade its own output — trigger coverage
goes to `skill:trigger-validator` and the pre-ship pass to `skill:quality-assurance`. It
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
| Trigger check | You invoke `skill:trigger-validator` | QualityGate invokes it while scoring the subgoal |
| Ship gate | You invoke `skill:quality-assurance` and act on its report | QualityGate invokes it; a failing report blocks the subgoal |

If a harness pipeline handed you the task, act in harness-engaged mode; otherwise default to solo and
run both gates yourself. Shipping also means bumping the plugin version in
`.claude-plugin/marketplace.json`, updating that plugin's README, and re-running
`_repo/scripts/validate_plugins.py`.

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

Readability is measured the same way, from the reviewer's side. For three merged diffs (requests,
flask, tokio) the draft loop's description, a no-skill draft, and the human original were shuffled
and handed with the diff to blind maintainer-judges who had to answer why / what / where-to-look /
what-the-author-doubts, flag any claim the diff doesn't support, and score 1–5. The first run had
the content — the skill draft was the only one a judge could review from, and the no-skill draft
asserted a "Closes #" the diff didn't earn — but lost on shape: 140-word opening paragraphs with
the why arriving after ~43 words. That became a rule in `references/pr-description.md` and a
prose-wall tell in the humanizer (why inside the first 30 words, no paragraph past ~80, a flat list
when three or more items are parallel and concrete). Second run: skill 5·5 / 5·5 against the
no-skill 4·4 / 4·4 and the human 3·2 / 2·2, why inside 15–20 words. The run also showed the
loop's one real failure mode: pressed by `[why]` to say what broke, the drafter invented a bug
("silently dropped" for a parameter the old code forwarded through `**options`). So the rewrite
that answers a `[why]` is re-read against the diff before the next round — every "before X, now
Y" needs a `-` line that shows X — and a `[why]` fix quotes the reason the material gives or says
"ask the author", never a cause the pass supplied.

### `like-me`

`writer-verification` makes text read as *a* person wrote it; this makes it read as *you* wrote it.
Give it 2–5 texts you wrote alone in the same genre (Slack, email, blog, PR, cover letter) and it
builds a counted voice profile — sentence length and spread, 종결어미 distribution, 존댓말 level,
opener/closer habits, recurring words, punctuation, formatting, hedging, code-switched terms — and
shows it to you before rewriting. Detection and writing are split: `writer-verification` runs first
and only its findings are kept — its generic fixes are discarded — then this skill closes each 🔴🟡
in your words, brings the rest onto the profile, and re-checks each row against a tolerance. A tell
your own samples use counts as voice, not a finding. It refuses to profile from one sample or from
AI-assisted text, and never imports typos as style.

```
내가 평소 슬랙에 쓴 메시지 3개 줄게. 이 공지 내 말투로 바꿔줘.
```

### `tech-book`

Writes a technical book as files under `tmp/books/<slug>/`, one stage at a time: brief, TOC, concepts, chapter
drafts, review, revision, copyedit, PDF. Nothing past the TOC is written until you approve `toc.md`. Each stage is
routed to a skill in this repo — `think:grill` for the brief and the TOC questions, a `develop:*` subject skill per
chapter (e.g. `database-optimizer` and `sql-pro` for a Postgres book), `cognition:epistemic-reasoner` to test every
analogy, `writer-verification` and a no-context reader for review — and a chapter's drafter never reviews it.
Every analogy to what the reader already knows ("MySQL에서는…") states where it breaks; every version or default
without a source is marked `[확인 필요]`; the TOC is swept for unmarked ones before you see it. Fact checks go to the official docs first and
the subject skill second — where they disagree, the docs win; an unreachable docs page is cited from a web.archive.org
copy with its capture date, or marked `[확인 필요]`. Findings use defined 🔴🟡🟢 levels and one line format,
counted once per defect. Every chapter carries six teaching elements once each — a prediction before a run, a
reproduced failure, a diagnosis task without the answer, a transfer task with traps, an observed edge case, an
equivalence check (non-code forms for non-code subjects) — inside a `length:` budget (default 25–35k characters);
a missing element is 🔴, padding, a give-away task or a reader stall is 🟡. From round 2 reviewers read only the diff, and a reviser writes first, grows the chapter at
most 15% a round and labels new claims. The fact check runs every lab the way the reader is told to, under
`references/lab-recipe.md` (unique project names, no host ports, teardown by name, never `prune`); each chapter ships
`rebuild-end-state.sh` with checksums, and the next chapter's review pins it by sha256. The review↔revise loop stops at
🔴🟡 = 0 or three rounds; at the cap one closure pass applies sourced one-line fixes and cuts known-false sentences,
re-checked by another agent, and what stays open goes to `status-NN.md`, never into the book. The final pass is
re-checked by an agent that neither drafted nor edited it, then one book-wide pass replays every chapter's end state. Status counts are recounted from the files when reported. The book ends in
`book.pdf`, typeset in NanumGothic (text) and NanumGothicCoding (code), bundled in the skill under SIL OFL 1.1 and
printed by any Chrome-family browser (`CHROME=<path>` to choose one). Figures are image files in `final/`, drawn with `write:diagram`, with their
caption kept on the same page; a book with a chapter or image missing, or an image not on its own line, still prints but exits 3 — partial, not done. `like-me` is used only if you give writing samples.

The book is designed around a starting performance, one observable terminal performance, a throughline, and a
capstone. Each chapter declares its entry and exit capability, misconception, step in a cumulative example, and
evidence. Chapters teach through a concrete problem, failure of the reader's prior model, a causal working model,
guided example, boundary, failure diagnosis, and independent transfer exercise with verification and an answer key.
Reader tests check the highest claimed level—recall, explanation, application, diagnosis, or design—and a final
book-wide pass checks difficulty jumps, prerequisites, example continuity, and whether the capstone is solvable from
the book alone.

```
비전공자용으로 Postgres 개념부터 심화까지 책 써줘. 나는 MySQL을 쓰니까 MySQL에 빗대서.
```

### `diagram`

Draws a checked figure instead of Mermaid or ASCII art. The agent decides figure or table first
(a figure only when the point is spatial, hierarchical, temporal across two or more actors, or a
measured comparison), writes a typed JSON IR and places every cell, row and column itself; the
script refuses, it never moves anything. Types: `architecture`, `dataflow`, `workflow`,
`lifecycle`, `sequence` (`references/diagram-ir.md`, the approach of
[archify](https://github.com/tt-a1i/archify) folded in without a dependency, split out of
`architecture-designer`) and `layout` (page layout, row + undo record, version chain; `축척 아님`
stamp when not to scale), `tree` (B-tree, clustered + secondary index, execution plan; key order
checked under either key convention), `timeline` (sessions, lock waits, deadlock), `er`
(crow's-foot ends with per-end optionality `1` · `0..1` · `0..*` · `1..*`, `UK` beside a unique
attribute) and `chart` (bar from 0, line, dot with the median drawn by the renderer)
(`references/figures.md`).

`node scripts/diagram.mjs check fig.json` measures every label with the embedded font and refuses
overflow, overlap, a line through a box or over a label, clipping, a label that would be cut, text
under 7.5 pt at a 146 mm book width, a character the font lacks, and each type's misleading cases
(sizes that do not add up, keys out of order, a wait no lock explains, a bar axis not from 0); each
refusal is phrased as its repair. `figure fig.json fig` then writes `fig.svg` — self-contained, no
script or external reference, a NanumGothic subset embedded as `@font-face` (tens of KB) — and
`fig.png` at 2x through a headless Chrome-family browser (exit 3 with the SVG written when none is
found; set `CHROME=`). The agent reads the PNG before calling it done, at most 3 rounds. An optional
`legend` object renames edge-style keys (`{"sync": "요청"}`); edge labels pick a spot clear of their
own line. `render fig.json fig.html` still writes the interactive HTML (hover, light/dark) for the
grid and sequence types.

The skill ships NanumGothic Regular + Bold (SIL OFL 1.1, licence in tech-book's `assets/fonts/`, shared), about 4 MB of
the plugin. Non-browser SVG renderers (librsvg, Inkscape, QuickLook) may ignore `@font-face`; the PNG
is the copy for those.

```
Draw the InnoDB 16KB page layout for chapter 9 as a figure, and the two sessions waiting
on one row lock as a timeline. Not Mermaid.
```

teams uses it too: `teams/mcp/diagram.mjs` is a byte-identical copy (a test fails on drift); shape
returns its package map in this IR, the manager renders it beside the docs, and critique and
integrate read its seams.

## MCP

Every skill in this plugin lists MCP tools as optional or recommended, not required:

| Skill | Tool | Used for |
|---|---|---|
| `requirements` | think-tool | Judging which rule or exception the input leaves out |
| `prd` | think-tool | Which document section holds the most unknowns |
| `adr` | think-tool | Weighing options and consequences |
| `plans` | sequential-thinking, think-tool | Dependency chains; judging whether a step is unambiguous |
| `writing-skills` | think-tool | Framing the RED-phase pressure scenario |
| `writer-verification` | think-tool, sequential-thinking, mcp-reasoner | Pass structuring; resolving conflicting findings; picking the summary lead |
| `like-me` | think-tool | Separating recurring habits from one-off noise in samples |
| `tech-book` | think-tool, sequential-thinking | Prerequisite order in the TOC and choosing analogies; clustering concepts into chapters |

Add the remote SSE endpoints in Claude settings → MCP Servers.

---

## Renames

- `write:diagram` — moved from `develop:diagram` (write 1.13.0 / develop 1.13.0); the old name no longer resolves.
- `write:like-me` — renamed from `write:write-like-me`; the old name no longer resolves.
