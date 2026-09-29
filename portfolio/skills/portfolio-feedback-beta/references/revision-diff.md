# Revision Diff — did the fix move anything?

When the user gives a previous version (a second file, or "이전 버전", "고친 버전", "v2",
"compare with my last one"), the deliverable is **movement**, not a second full review.
Promoted from the beta lane after a head-to-head on a v1/v2 pair: the structured diff caught two
regressions the ad hoc comparison missed — a role claim (`설계`) the rewrite introduced into the
summary with no bullet to back it, and a "12개월 무사고" window that had closed twenty months
before the review date.

## Tally definitions (pin these before counting either version)

Tallies are only comparable when both versions are counted the same way. Before writing any
`n/m`, list the bullets you are counting by number — a tally without its list is a guess.

| tally | denominator m | numerator n |
|---|---|---|
| **XYZ+S** | every bullet under Experience and Projects/OSS — a duty-only bullet is exactly the failure this measures, so it stays in m. Summary lines, Skills, Education are out. **Deck / document format:** outcome-claim bullets only; design narration is out (§0 of `claim-and-consistency.md`). | bullets carrying all four of X, Y, Z, S (§4 of `resume-conventions.md`) |
| **의사결정 동사** (국문) | 행동 문장 — bullets and summary sentences with an action verb | those whose verb is 제안·채택·배제·결정·판단 (§2) |
| **불릿/롤 max** | — | the largest bullet count under any single role |
| **레드 플래그** | — | count of flags from the `screen-models.md` catalog |

Count once per version, then re-count the version with the higher number: the most common
revision error is crediting an S that is not there.

## The diff

1. Run every tally on both versions and print them side by side:

   | 지표 | Before | After |
   |---|---|---|
   | XYZ+S | n/m | n/m |
   | 의사결정 동사 (국문) | n% | n% |
   | 불릿/롤 max | n | n |
   | 레드 플래그 | n | n |
   | 리크루터 / 엔지니어 판정 | 판정 / 판정 | 판정 / 판정 |

2. One line: did the screen verdict move, and what single change moved it. If nothing
   moved at the screen, say so — a revision that improved four tallies and no verdict is
   still a revision that does not get read.
3. **Regressions get their own lines.** A rewrite that added numbers and lost the decision
   verbs, or fixed the summary and pushed contact into the header, has traded one screen
   cost for another. List each regression with the sentence that caused it. Check
   specifically for claims the rewrite *introduced* — a new summary line that says 설계 / 리드
   / owned while the bullets below still say 개발 / 참여 is a regression, not an improvement.
4. **Unresolved items from the previous verdict**, one line each. Fixed items get a single
   summary line, not re-praise — the candidate knows what they fixed.
5. **Stale windows.** Any claim with a time window ("2024.01 이후 12개월 무사고", "최근 6개월")
   is checked against today's date; a window that closed long ago is an open question.

The rest of the standard output (dimension scores, strengths, vulnerability, questions,
priorities) follows, but scored on the new version only and shortened: anything unchanged
since the previous verdict is referenced, not re-derived.

If `sequential-thinking` is available, use it to carry the before/after tallies as you compute
them, so the verdict-movement line and each regression trace to a specific tally change rather
than being reconstructed afterward.
