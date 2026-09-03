---
name: writer-verification
effort: high
description: >-
  Use when writing must read as if a person wrote it — reviewing text, or drafting a PR
  description or post and revising until the machine tells are gone. Triggers on: "글 검토해줘",
  "맞춤법 확인", "proofread", "글 다듬어줘", "PR 설명 써줘", "AI 티 나", "사람이 쓴 것처럼".
scenarios:
  - "이 이메일 자연스러워?"
  - "블로그 포스트 올리기 전에 검토해줘"
  - "이 diff로 PR 설명 써줘, AI 티 안 나게"
  - "Proofread this PR description"
  - "This reads like ChatGPT wrote it — fix it"
  - "Write the release note for this branch like a person would"
compatibility:
  optional:
    - think-tool        # which findings most change the reader's experience
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 Summary 전에 어떤 발견이 독자 경험을 가장 크게 바꾸는지 고를 때 씁니다.
    sequential-thinking은 inline 모드에서 다섯 패스를 순서대로 밟을 때 씁니다.
---

## Standing Mandates

- ALWAYS include original → fix + reason in every finding. Pointing out without fixing is half a review.
- ALWAYS run the humanizer pass. Correct grammar and good rhythm do not make text read as human; the tells are structural — headers on short text, what-without-why, nobody's-voice register.
- NEVER, in draft mode, hand over a draft that has not been through the passes. The first draft is input to the loop, never output.
- NEVER, in draft mode, add a header, bold label, or bullet the text did not need at that length. A PR description for a 40-line diff is three sentences.
- NEVER, in draft mode, hand over a prose wall either: why inside the first 30 words, no paragraph past ~80 words, and a flat list when there are three or more parallel concrete items. Reviewers skim; scannable is the human shape.
- NEVER write a PR description that lists files or opens with "This PR …". Open with why; the diff shows what.
- NEVER invent a fact while drafting or fixing. Every number, cause, name, and expanded acronym comes from the material or from the author — `PG` stays `PG` unless the material says what it stands for. A pass that "clarifies" a term it cannot verify has introduced an error, not fixed one.
- ALWAYS write in the language the user asked in, unless they say otherwise. A Korean request gets a Korean PR description, code identifiers untouched.
- ALWAYS stop the draft loop on 🔴🟡 = 0 or after three rounds, and say which — a fourth round is polishing, not fixing.
- Goal: a reader cannot tell this was reviewed or drafted by a model, and a reviewer of a PR knows where to look and what the author was unsure about.

# Writer Verification

Five review passes over a text, each with one job, and a draft loop that runs them on Claude's own
writing until the findings run out. The fifth pass is the one that closes the human-vs-AI gap: it
does not check whether the text is correct, it checks whether a person would have written it that way.

---

## Process

**0. Decide the mode.**

| Input | Mode |
|---|---|
| Existing text to check | Review |
| A diff, branch, outline, or "write X for me" | Draft |

Also note the **genre** (`pr` · `commit` · `doc` · `blog` · `message`) and audience; the humanizer
weights findings by genre.

**1. Review mode.** Count characters.

- **< 300 chars — inline:** read `references/passes.md`, run all five passes in order.
- **≥ 300 chars — parallel:** dispatch all five in one turn, wait, aggregate.

| Pass | Agent | Looks for |
|---|---|---|
| 1. Spelling & Grammar | `agents/grammarian.md` | correctness |
| 2. Writing Patterns | `agents/editor.md` | rhythm, repetition, passive |
| 3. Expression & Style | `agents/copywriter.md` | vague words, clichés, tone |
| 4. Reader Perspective | `agents/reader.md` | assumed knowledge, logic gaps, core message |
| 5. Humanizer | `agents/humanizer.md` | machine tells: shape, register, what-without-why |

Uncertain Korean spelling → `references/korean-spelling.md`. Genre `pr`/`commit` →
`references/pr-description.md` is loaded by pass 5.

Aggregation: deduplicate by span, keep the higher severity and note both sources; conflicting fixes
are shown side by side with attribution. If `mcp-reasoner` is available, use it when two passes
flag one span for incompatible reasons.

**2. Draft mode.**

1. Gather the material. For a diff: commit messages, linked issue, the diff itself — derive *why*
   as `references/pr-description.md` describes; if why is not recoverable, ask the author one
   question before writing.
2. Write the first draft as the author would say it to a colleague — in the language the user
   asked in, at the length the material earns, no scaffolding.
3. Run the five passes on the draft (inline or parallel by length, as above).
4. Apply every 🔴 and 🟡. Rewrite the affected sentences; do not patch words in.
5. Repeat 3–4 until 🔴🟡 = 0 or three rounds have run. From round 2 on, re-run only the passes that
   returned 🔴🟡 in the previous round, plus the reader pass on any rewritten paragraph — a pass that
   came back clean stays clean. The exception is the material check: a rewrite that answers a
   `[why]` finding is where invented causes enter, so before the next round, read every
   "before/after" sentence the rewrite added against the diff (`references/pr-description.md`,
   "Reading a diff") and cut any claim without a `-` line behind it. Measured: the loop's own
   fix introduced "silently dropped" for a parameter the old code already forwarded.
   A finding only the author can close — missing doubt when the material states none, missing
   reason when it names none — moves to the "left for you" note after the round it first appears
   in and stops counting toward 🔴🟡; re-flagging it three times is what ran a 172-word draft to
   the round cap.
6. Deliver the final text, then a three-line note: rounds run, what the loop caught, what 🟢
   remains for the author to decide.

**3. Summary (review mode).** If `think-tool` is available, use it here to pick the one or two
findings that most change the reader's experience; those lead the summary.

---

## Output Template

Review mode — full template in `references/output-format.md`:

```
## Spelling & Grammar · ## Writing Patterns · ## Expression & Style · ## Reader Perspective
## Humanizer
- 🔴 [why] "This PR refactors the retry logic" — what without why → "Checkout timed out for ~3% …"
- 🟡 [shape] 4 headers over 120 words → three sentences, no headers
## Summary
[2–3 lines: what works, the 1–2 changes that matter most]
```

Draft mode:

```
[final text — nothing above it]

---
Draft loop: N rounds · caught: [why missing, 4 headers → prose, 3× "leverage"] · left for you: [🟢 …]
```

Priority: 🔴 Must fix (meaning, logic, missing *why* in a PR) · 🟡 Recommended (patterns, tells)
· 🟢 Optional (style preference).

---

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Runs all five passes; never skips the humanizer | Say the genre and audience if they aren't obvious |
| In draft mode, loops its own draft until the findings run out, then shows only the result | Answer the one "why" question if the material doesn't say |
| Shows original → fix + reason for every finding | Decide the 🟢 items — those are taste, and it's your voice |

## Related Skills

- `write:doc-coauthoring` — when the document's content is still being decided, not its wording
- `write:technical-blog-writer` — long-form drafting; hand the result here for the loop
- `develop:clean-code` — for the commit itself; this skill covers the description of it
