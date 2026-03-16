# Output Format

Use this exact structure for all reviews.

```
## Spelling & Grammar
- [fix] "됬어요" → "됐어요" (vowel contraction: ㅏ+ㅣ→ㅐ)

## Writing Patterns
- [warning] Para 1: 3 sentences starting with "그리고" → reorder or drop connectors

## Expression & Style
- [fix] "혁신적인 솔루션을 제공합니다" → "배포 시간을 50% 단축하는 자동화 도구를 제공합니다"

## Reader Perspective
- [check] Adjust tech-term density in para 2 for general audience

## Summary
[2-3 lines: what the text does well + the top 1-2 improvements that matter most]
```

## Priority Labels

- 🔴 **Must fix** — meaning errors, factual mistakes, logic gaps that break comprehension
- 🟡 **Recommended** — patterns and phrasing that weaken the writing
- 🟢 **Optional** — style preferences, minor polish

## Rules

- Every finding must include: original → fix + reason. Pointing out without fixing is half a review.
- In parallel mode: deduplicate findings by location, attribute source pass when two passes flag the same span.
- Keep the Summary to 2-3 lines. Lead with strengths, close with the most actionable improvement.
