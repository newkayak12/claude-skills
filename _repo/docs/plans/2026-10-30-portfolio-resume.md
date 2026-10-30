# portfolio — resume from the built deck (manage step 9)

Card 104. User, 2026-10-30: "deck build 된거 기준으로 source랑 같이 resume로 가는 것도 만들면 좋을 듯
똑같이 template 바탕으로 word 형식으로 쓰고 pdf로 내보내는"; then "manage 네" (a manage step, not a skill).

## What it is

Step 9 of `portfolio:manage`, after the deck is built: the same settled claims, shorter, in the
user's own Word template, written to `build/resume.docx` and exported to `build/resume.pdf`.

## Source of each line

| Resume part | Comes from | Rule |
|---|---|---|
| Header (name, contact, links) | `docs/확정사실.md` `## 이력서 머리` | the user's own lines; never invented |
| Summary | the deck's cover/core-strength sentences | the same sentences in the same order (principles § Strengths) |
| Experience, per company | `sources/선정.md` `본문` items grouped by `meta.md` period/role | one bullet per item: its 대표 line, then at most two results |
| Projects / appendix work | `부록` items | one line each |
| Skills | only what a bullet uses in context | a skill no bullet shows is not listed (feedback's 스킬 근거율) |

Every bullet carries its `글감: <id>` while drafting (`resume.md`, the source like skeleton.md),
and `claims --file resume.md` passes before anything is written to Word. Figures `근거 없음` never
reach the resume; `본인 확인` work does.

## Files

```
resume.md               draft source: `## 회사 · 기간 · 역할` sections, bullets with `글감:`
template/resume.docx    the user's Word template (the base, as template.pptx is for the deck)
build/resume.docx       written from resume.md into the template's styles
build/resume.pdf        exported with LibreOffice (same renderer as deck-builder render)
snapshot/resume/resume-vX.Y.Z/   resume.md per version (snapshot --kind resume)
```

## Engine (node or python, stdlib, tested)

- `resume catalog --template template/resume.docx`: lists the template's paragraph styles in use
  (heading, bullet, body, header table) and which sample paragraph carries each.
- `resume build`: copies the template, removes its sample body, writes each `resume.md` part with
  the style the catalog mapped to it (zip + `word/document.xml`, like deck.py does for pptx; no
  built-in look).
- `resume render`: `soffice --convert-to pdf`, page count reported; over the page budget warns.
- Checks: `claims` on resume.md; `feedback` resume conventions (one to two pages, XYZ+S bullets,
  dates scannable, ATS-safe: no text boxes, no tables for body text).

## Decisions for the user

1. A Word template exists (`template/resume.docx`)? If not, which one to start from.
2. Page budget: one or two pages.
3. Language: Korean only, or Korean + English versions.

## Not doing

JD-tailored variants (cut in the 2026-10-29 debate); a built-in resume design.
