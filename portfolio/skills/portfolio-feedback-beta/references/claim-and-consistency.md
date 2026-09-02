# Consistency Cross-check, Claim Audit, Revision Diff

Three passes that the convention check (`resume-conventions.md`) does not cover. The
convention check judges how each bullet is built; these judge whether the document agrees
with itself, whether its numbers survive one follow-up question, and whether a revision
actually moved anything. All three produce tallies, not adjectives.

## A. Consistency cross-check — does the document agree with itself?

The engineer 30-second pass catches contradictions faster than anything else, because a
contradiction needs no domain knowledge to spot. Check four things; report only what fails.

1. **Dates across sections.** Experience dates vs. project dates vs. the tenure the summary
   claims (`백엔드 5년` against experience that sums to 3.5). A project dated outside the
   role it sits under, two roles overlapping without explanation, a summary tenure that the
   dates do not support. Tally: `날짜 불일치 n`.
2. **Skills index vs. evidence.** A Skills section is an index, not evidence. For every
   entry in it, is there at least one experience or project bullet where that skill is
   *used with context* — not merely named again in another list? Tally: `스킬 근거율 n/m`
   (entries with evidence / entries listed). Under ~60% is skill inflation and goes in the
   red-flag block; name the unevidenced entries so the candidate can either add the bullet
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
solo side project implies attribution; a before → after pair implies baseline). Tally:
`완전 주장 n/m` over every bullet that asserts an outcome. Target ~70%; under ~40% is a
red flag (검증 불가 주장 비율) rather than a form note.

Name the **worst three** incomplete claims — the ones with the highest visibility (summary,
first bullet of the most recent role) — and for each write the exact interview question it
invites. Those questions feed the expected-questions block directly: an incomplete claim
is not a *possible* question, it is a certain one.

Do not double-count with XYZ+S. A bullet can be XYZ+S-complete and claim-incomplete
(`배포 30분 → 4분` has X, Y, Z, S but no period and no attribution). Report both tallies;
they answer different questions.

## C. Revision diff — did the fix move anything?

When the user gives a previous version (a second file, or "이전 버전", "고친 버전", "v2",
"compare with my last one"), the deliverable is **movement**, not a second full review.

1. Run every tally on both versions and print them side by side:

   | 지표 | Before | After |
   |---|---|---|
   | XYZ+S | n/m | n/m |
   | 의사결정 동사 (국문) | n% | n% |
   | 불릿/롤 max | n | n |
   | 스킬 근거율 | n/m | n/m |
   | 완전 주장 | n/m | n/m |
   | 날짜 불일치 | n | n |
   | 레드 플래그 | n | n |
   | 리크루터 / 엔지니어 판정 | 판정 / 판정 | 판정 / 판정 |

2. One line: did the screen verdict move, and what single change moved it. If nothing
   moved at the screen, say so — a revision that improved five tallies and no verdict is
   still a revision that does not get read.
3. **Regressions get their own lines.** A rewrite that added numbers and lost the decision
   verbs, or fixed the summary and pushed contact into the header, has traded one screen
   cost for another. List each regression with the sentence that caused it.
4. **Unresolved items from the previous verdict**, one line each. Fixed items get a single
   summary line, not re-praise — the candidate knows what they fixed.

The rest of the standard output (dimension scores, strengths, vulnerability, questions,
priorities) follows, but scored on the new version only and shortened: anything unchanged
since the previous verdict is referenced, not re-derived.
