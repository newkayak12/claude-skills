# Lenses — the rendered text read five ways at once

Step 3b of `render-review`. One opus subagent per lens, all five sent in **one message** so they run
together. Each gets the same input and only its own lens; none edits a file.

## Input every lens gets

- The page text, per page: `pdftotext -layout build/<file>.pdf -` split on form feeds (or the
  `office_render.py` bbox text when pdftotext is missing), with the page number.
- The render's own measures for that page: the `layout:` lines, `held …` lines and `figure text:`
  lines `deck.py render` printed (figure text pt reached, lone words, split numbers, zones).
- `portfolio-skeleton.md` / `resume-skeleton.md` headlines, so a lens knows what each page claims.
- The `[확정]` list from `manage` (settled wording): a settled sentence is not a finding.

## The five lenses

| Lens | Reads for | Not its job |
|---|---|---|
| 가독성 | a line holding two ideas; a bullet over two lines on a deck; a number with no unit or baseline in reach; figure text the render measured under 7.5pt; a page with no line a 6-second reader can take away | wording taste |
| 문체 | one register per document (합니다체 vs 음슴체 vs 명사형 mixed within a block); the same sentence ending three or more times in a row; passive or subject-less claims of the candidate's own work (`portfolio:pattern` agency rules) | word choice |
| 단어 선정 | vague verbs (진행·담당·참여·기여 with no object of what was decided); one thing named two ways across pages; jargon a recruiter cannot place without its gloss; English and Korean terms mixed for one concept | sentence order |
| AI티 | the tells in `write:writer-verification` `references/passes.md` pass 5: parallel triplets, "~를 통해 ~를 달성", evaluative adjectives the evidence does not carry, summary lines that restate the headline, symmetric bullet lengths | facts |
| 글 흐름 | headline → bullets → figure in one line of argument; a bullet that answers a question the page never asked; the problem/solution panels pairing one-to-one; the jump between consecutive pages | grammar |

## What each lens returns

One row per finding, nothing else:

```
| 쪽 | 관점 | 원문 (그대로 인용) | 문제 (한 줄) | 바꿀 문장 |
```

- **원문** is copied from the page text, never paraphrased; a finding without a quote is dropped.
- **바꿀 문장** is the whole replacement sentence, same facts, same length or shorter, no new
  number, name or claim (`feedback`'s "content, not only the place"). A number or name brought
  from another page, or a meaning the original did not state, is `[확인 필요]` (first run,
  2026-11-19: a system name and a client name carried in from other pages; "적용할 수 있는"
  became "범위가 작은").
- The merge step checks every 바꿀 문장 against its page text before it reaches `검토.md`.
- A finding the lens is unsure is a choice is `[확인 필요: 의도]`, never a defect.
- Nothing found → `없음` for that lens, said once.

## Merging

1. Same 원문 from two lenses → one row, 관점 `문체·AI티`, the shorter replacement kept.
2. Rows go into `검토.md` under the page (a `관점` column) and into `template/next-render.md`
   (쪽 · 칸 · 증상 · 확인 · 적용), the replacement in 적용.
3. The user's own sentences are changed in `deck.mdx` / `resume-deck.mdx` only when the user says
   "고쳐"; until then they wait in `next-render.md`.
