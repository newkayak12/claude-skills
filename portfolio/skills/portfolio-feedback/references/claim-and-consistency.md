# Consistency Cross-check, Claim Audit, Level Calibration

Three passes that the convention check (`resume-conventions.md`) does not cover. The
convention check judges how each bullet is built; these judge whether the document agrees
with itself, whether its numbers survive one follow-up question, and whether the level the
document claims is the level it reads at. All three produce tallies, not adjectives. Revision
mode lives in `revision-diff.md`; §C says what these passes add to it. Promoted from the beta
lane after two head-to-heads plus a count-reliability bench (every tally re-countable on two fixtures).

## A. Consistency cross-check — does the document agree with itself?

The engineer 30-second pass catches contradictions faster than anything else, because a
contradiction needs no domain knowledge to spot. Check four things; report only what fails.

1. **Dates across sections.** Experience dates vs. project dates vs. the tenure the summary
   claims (`백엔드 5년` against experience that sums to 3.5). A project dated outside the
   role it sits under, two roles overlapping without explanation, a summary tenure that the
   dates do not support. Tally: `날짜 불일치 n`.
2. **Skills index vs. evidence.** A Skills section is an index, not evidence. For every
   entry in it, is there at least one experience or project bullet where that skill is
   *used with context* — not merely named again in another list? An entry is evidenced when
   a bullet names it, or names something that only exists inside it (`Spring Batch` evidences
   `Spring Boot`/`Spring` and the JVM language the summary states; `N+1 제거·인덱스 추가` with one
   database in the list evidences that database). A list of two databases with an anonymous
   index bullet evidences neither. Tally: `스킬 근거율 n/m` (entries with evidence / entries
   listed). Under ~60% is skill inflation and goes in the
   red-flag block (provisional threshold — set from fixture reviews, not research; see §F); name the unevidenced entries so the candidate can either add the bullet
   or delete the entry.
3. **Role claim vs. bullet language.** A summary or title that says 리드 / owned / 설계 while
   the bullets under it say 참여 / 지원 / 기여. Tally as a count of roles where the claimed
   level and the bullet verbs disagree.
4. **Mixed conventions.** Two date formats, tense switching within one role, a tech name
   spelled two ways (`Postgres` / `PostgreSQL` is fine; `Kubernetis` is a typo, not a
   variant). One line each, only when present.

The same conversion-artifact rule as §8 of the conventions file applies: reading-order
scrambles are the pipeline's fault, not the candidate's. Judge dates and names as written,
not as they landed after extraction.

## B. Claim audit — does each number survive one question?

XYZ+S measures whether a bullet has the right *shape*. This measures whether the number in
it would survive the first interviewer question. Every impact claim carries four elements:

| element | the question it pre-empts |
|---|---|
| **수치 / number** | "How much?" |
| **베이스라인 / baseline** | "From what?" — `p99 140ms` means nothing without `from 800ms` |
| **기간 / period** | "Over how long, measured when?" |
| **기여 범위 / attribution** | "What part of that was you?" — team result vs. own change |

A claim is **complete** when all four are present or unambiguously implied by context (a
solo side project implies attribution; a before → after pair implies baseline). Attribution
is read from the verb: an unhedged action verb (`수정`, `개선`, `이관`, `구현`) claims the change
as the candidate's own and counts as present; a hedge (`기여`, `참여`, `지원`, `함께`) or a
team-scoped subject counts as missing. A period is present when the bullet dates the result
(`2023.Q2`, `2022.09 이후`) — an open window is a period, a missing one is not. Tally:
`완전 주장 n/m` over every bullet that asserts an outcome. Target ~70%; under ~40% is a
red flag (검증 불가 주장 비율) rather than a form note (both provisional — §F).

**Interaction with the Impact and Results score.** The claim audit and the rubric look at the
same bullets, so apply one rule to avoid double-penalising or contradicting: `완전 주장` sets a
**ceiling**, never a score. Under ~40% complete, Impact cannot exceed 6 (rubric level 4–6,
"numbers without context") whatever the numbers look like; at or above 70% the ceiling is
off and the rubric decides alone. State the ceiling once, in the Impact dimension's
devil's-advocate line, and do not mention the audit again in the score block.

Name the **worst three** incomplete claims — the ones with the highest visibility (summary,
first bullet of the most recent role) — and for each write the exact interview question it
invites. Those questions feed the expected-questions block directly: an incomplete claim
is not a *possible* question, it is a certain one.

Do not double-count with XYZ+S. A bullet can be XYZ+S-complete and claim-incomplete
(`배포 30분 → 4분` has X, Y, Z, S but no period and no attribution). Report both tallies;
they answer different questions.

## C. Revision diff — did the fix move anything?

Follow `revision-diff.md` (tally definitions, table, regressions, unresolved, stale windows) and
add four rows to its table, counted with the definitions above:

| 지표 | Before | After |
|---|---|---|
| 스킬 근거율 | n/m | n/m |
| 완전 주장 | n/m | n/m |
| 날짜 불일치 | n | n |
| 레벨 갭 | ±n | ±n |

## D. Counting and reporting rules

- **List before you count.** Every `n/m` in this file is preceded — in your working, not
  necessarily in the output — by the numbered list of items in m. A tally whose list you
  cannot produce is not reported. Re-count the side with the higher number by writing the
  per-section subtotals (`오더플로우 7 + 데이터브릿지 3 + 프로젝트 2+2 = 14`) and checking that
  the sum equals the length of your list — a list that is one short of the subtotals has
  dropped a bullet, and the second head-to-head lost `레거시 쿼리 튜닝 수행` exactly this way.
- **Denominators.** `완전 주장`: bullets and summary sentences that assert an outcome (a
  number, or a qualitative result such as 재발 방지) — a duty-only bullet cannot be an
  incomplete claim and is out. A scale figure that describes the environment (`일 120만 건
  결제`) is context, not a claim; it is out unless it is presented as something the candidate
  achieved. `스킬 근거율`: m is every entry in the Skills section, deduplicated. `XYZ+S` and
  `의사결정 동사` use the definitions in `revision-diff.md`.
- **Say each finding once.** A contradiction lives in the Consistency block; an incomplete
  claim lives in the Claim Audit block. The red-flag block, 총평, and priorities refer to it by
  name (`스킬 인플레이션 2/12 — 정합성 참조`) and never restate the evidence. An early bench of
  these passes found the same 5년 discrepancy stated three times in one review — that is
  length the screen pays for and the candidate does not.

## E. Level calibration — is the claimed level the level it reads at?

A document claims a level three ways: 연차 in the summary (`백엔드 7년`), 직함 (시니어 / 테크
리드 / Staff), and the role the user says they are applying for. §A.3 checks one role's title
against its own bullets; this pass reads the **whole document** at a level and compares.

Read level is set by evidence, never by years. Use this ladder and cite the two bullets that
set the ceiling — the read level is the highest rung with two bullets on it, not the rung the
best single bullet reaches:

| rung | what the bullets show |
|---|---|
| **주니어** | executes defined tasks; outcomes are completion (`관리자 페이지 백엔드 개발`) |
| **미드** | owns a component end to end; outcomes measured; decisions stay inside the component |
| **시니어** | chooses between alternatives with the tradeoff stated; scope crosses components; a failure owned |
| **리드 / Staff** | others' work depends on the decision; team- or system-level scope; direction or mentoring with evidence |

Report `레벨 갭: 주장 <rung> / 읽힘 <rung> (±n)` with the two ceiling bullets quoted. Then the
direction decides what it means:

- **Over-claim** (주장 > 읽힘): this is the 직함 인플레이션 flag with a number on it. Interview
  defense is scope in numbers (team size, what was owned); rewrite direction is one bullet per
  rung claimed, not a softer title.
- **Under-claim** (읽힘 > 주장): the highest-leverage rewrite in the document — senior evidence
  in junior framing. Goes to Improvement Priorities #1 unless something at the screen outranks it.
- **Match** (±0): one line, then nothing more — do not pad.

Korean market note: 연차 ↔ level is loose (5년 is *expected* to read 시니어, not guaranteed to),
so 연차 alone never sets the claimed rung — it sets the reader's expectation, and a gap against
that expectation is what the engineer 30-second pass actually reacts to.

## F. Provisional thresholds

`~60%` (스킬 근거율), `~40% / ~70%` (완전 주장), and the two-bullet rule for read level were
set from the fixture reviews in `evals/files/`, not from screening research. Treat them as
working thresholds: report the tally, apply the threshold, and revisit after ten real documents.
Do not present them to the candidate as industry numbers.

