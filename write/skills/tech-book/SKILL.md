---
name: tech-book
effort: high
description: >-
  Use when a technical book or multi-chapter guide is written in stages: approved TOC, per-chapter review loop, PDF.
  Triggers on: "기술서적 써줘", "책 집필", "개념부터 심화까지 책으로", "책 목차→검수→퇴고로 가자", "write a tech book".
scenarios:
  - "Write a Postgres book for non-majors, explained through MySQL"
  - "Draft a MongoDB guide chapter by chapter, with a review loop before anything is final"
  - "비전공자용으로 Postgres 개념부터 심화까지 책 써줘, MySQL에 빗대서"
  - "소프트웨어 공학 책 목차부터 잡아줘"
  - "한 번에 쓰지 말고 목차 → 개념 → 검수 → 퇴고로 가자"
compatibility:
  optional:
    - think-tool          # prerequisite order in the TOC, choosing which analogy fits a concept
    - sequential-thinking # clustering concepts into chapters
  remote_mcp_note: >-
    think-tool이 있으면 목차의 선행 순서와 개념마다 어떤 비유가 맞는지 고를 때 씁니다. sequential-thinking은 개념을
    장으로 묶을 때 씁니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- NEVER write the book, or any chapter, in one pass from the request, and NEVER start stage 2 before the user approves
  `toc.md`. Reader level, order, and scope are decided by the TOC; a one-pass draft hardens them before anyone chose.
- NEVER state a version, default value, config name, limit, or benchmark without a source. Write
  `[확인 필요: <fact>]` instead. One wrong default discredits a reference book, and a non-major cannot catch it.
- ALWAYS close every analogy to the anchor (e.g. "MySQL에서는…") with where it breaks. A non-major carries an analogy
  past the point it holds; the break line is what stops them.
- NEVER let the agent that drafted a chapter review it. Review is a separate agent; its findings are applied, not argued.
- ALWAYS stop the review↔revise loop on 🔴🟡 = 0 or after three rounds, and say which — a fourth round is polishing.
- NEVER run `write:like-me` without ≥ 2 samples the user wrote alone. like-me is the user's voice, not "like other
  books"; the default copyedit is `references/house-style.md`.
- ALWAYS invoke each routed skill by name, visibly (`references/skill-routing.md`): without its SME skill a chapter
  repeats what a general model guesses. Not installed → read its `SKILL.md` from the repo, follow it, and say so.

Goal: a non-major reads chapter N knowing only chapters 1..N-1 and the anchor; every fact is sourced or marked; the
closing status recounts to the files on disk.

# Tech Book

Writes a book as files under `tmp/books/<slug>/`, ending in `book.pdf`; outside this repo, if `tmp/` isn't gitignored,
tell the user before writing. Resume stages 0–2 from the highest on disk, each chapter from its latest file.

**Not for:** a single document, design doc, or blog post (`write:plans`); reviewing existing text
(`write:writer-verification`); a voice rewrite (`write:like-me`); a spec from a conversation (`write:spec`).

## Process

0. **brief.md.** Reader level, anchor (what the reader knows), scope in/out, register, sources. One `think:grill` round
   with a recommended answer per question; unanswered → `[확인 필요: … / 추천: …]` in the brief. The first turn ends here.
1. **toc.md.** `think:untangle-thoughts` (Outline). One block per chapter in the `references/house-style.md` format:
   goal, `requires:` (earlier chapters only, order checked with think-tool), anchor analogy candidates, `sme:` (from
   `references/skill-routing.md`). Sweep it first: every unsourced version, default, limit gets `[확인 필요]`; list what
   you checked. Present it with one `think:grill` round. **Stop: no stage 2 until the user approves toc.md.**
2. **glossary.md + concepts/NN.md.** Once per book (shared glossary); sequential-thinking clusters, think-tool picks
   analogies. Per concept: definition, prerequisite, analogy + where it breaks, one example, `[확인 필요]` items.
   `knowledge:base-builder` / `knowledge:query` only when the user supplied sources.
3. **draft/NN.md.** `agents:dispatching-parallel-agents`, one agent per chapter, its `sme:` skill mounted. No worktree
   (`tmp/` is gitignored: a worktree strands the file); each writes only its own absolute path in `tmp/books/<slug>/`.
4. **review/NN-rK.md.** Four checks, concurrent, never by the drafter, in one file: fact-check against the official docs
   (or the user's sources) first, cited by URL, the SME skill second — an SME-vs-docs conflict is 🔴, docs win.
   Official page unreachable: cite a web.archive.org copy by archive URL and capture date, naming the page unreachable
   in the review file; no copy → `[확인 필요]`. `cognition:epistemic-reasoner` tests every analogy and absolute claim;
   `write:writer-verification` review mode (genre `doc`, audience from the brief); `../plans/agents/reader-agent.md`
   asks each learning goal as a question — at most 5 per chapter per round. Findings: 🔴🟡🟢, original → fix.
5. **Revise draft/NN.md.** Close every 🔴🟡, then back to 4; from round 2 re-run only the checks that flagged something.
   At the cap nothing more is revised: every open 🔴🟡 goes to `## 남은 항목` at the end of the chapter.
6. **final/NN.md.** House-style copyedit, one `write:writer-verification` pass, `glossary.md` terms checked book-wide;
   `write:like-me` only with user samples, `develop:architecture-designer` for system figures only. A fact or meaning
   change (added sentence, re-pointed reference) gets one re-check by an agent that neither drafted nor made it, or
   goes to `## 남은 항목`.
7. **book.pdf.** `node scripts/render-pdf.mjs tmp/books/<slug>` — toc.md order, NanumGothic fonts of `assets/fonts/`
   (page, type, figures: `references/house-style.md`). Exit 1: no browser (`book.html` kept) — ask for `CHROME=<path>`.
   Exit 3: PDF written but a chapter or image is missing, or an image is not on its own line — report them; a partial
   book, never done. Never swap in another font: the page is set to Nanum metrics, and only these ship licensed.

Done: render exit 0, then `completion:verification-before-completion` with an isolated verifier against the Goal line
and book.pdf (exists, ≥ 1 page, every toc chapter rendered). Parallelism: one agent per book for stages 0–1, stage 2
once per book, 3–6 per chapter, then one book-wide glossary pass; no two agents write the same file.

## Output Template

```
Next: <the one decision for the user — e.g. approve toc.md, answer grill items 2·4>
Book: <title> · tmp/books/<slug>/ · stage <n> of 0–7
Chapters <k>: final <a> · in loop <b> (round r/3) · stopped at cap <c>
Review open: 🔴 x · 🟡 y · 🟢 z | analogies tested <n>: hold <h> · break stated <b>
Unverified: <m> × [확인 필요] — <list>
Skills run: <plugin:skill × stage>
```

Before stage 3 the Chapters and Review lines read `—`. Counts are recounted from the files at report time; a count not
re-measured since the last change names its round, e.g. `(r3)`. Do NOT paste chapters into chat — they are in the files.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Drafts the brief and the TOC, routes each stage to its skill, runs the review loop | Approve toc.md; answer the grill items |
| Marks every unsourced fact `[확인 필요]` | Confirm those facts, or point to a source |
| Reports the stage it stopped at and why | Decide the leftover 🟢; give writing samples if you want like-me |

## Related Skills

- `references/skill-routing.md` — which skill runs at which stage, with what input; `write:plans` — a single document.
- `write:writer-verification` — review passes, stages 4 and 6; `write:like-me` — the user's voice, stage 6, with samples.
