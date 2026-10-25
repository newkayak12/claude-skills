---
name: material
description: >-
  Use when someone hands over career material (retrospectives, resumes, notes,
  chat dumps) to collect as portfolio items before writing. Triggers on:
  "글감 모아줘", "회고로 포트폴리오 재료", "collect my material".
scenarios:
  - "Here is my retrospective. Collect the episodes as portfolio material."
  - "I added one detail to the payment-migration story and answered your question — update it."
  - "Turn these notes and chat logs into material items, don't make anything up."
  - "이 회고록에서 글감 모아줘"
  - "내가 준 자료로 에피소드별 글감 폴더 만들어줘"
  - "지난번 질문에 답했어, 글감 업데이트해줘"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    MCP 없이도 동작합니다. think-tool은 에피소드 경계나 병합 여부가 애매할 때만 쓰입니다.
---

# Portfolio Material

Collection only: material in, `material/<id>/` items out. **Not for** writing the portfolio, rendering a deck, or feedback loop-back (later steps).

Script, run from the project root: `node ${CLAUDE_PLUGIN_ROOT}/skills/material/scripts/material.mjs <subcommand> [flags]`. Each prints one JSON object.

| Subcommand | Flags | Does |
|---|---|---|
| `id` | `--source --title` | Returns the slug id |
| `match` | `--id --source --title` | `new` / `same` / `ambiguous` (+ candidates); writes nothing |
| `init` | `--id --source --title` (opt. `--period --role --tags`) | Creates the item folder with the seven parts, status `raw`; `exists` writes nothing |
| `index` | none | Rewrites `material/index.md` only if its content changes |
| `log` | `--id --note` (opt. `--add-source`) | Appends a line to `history.md`; a note already there is `unchanged`. `--add-source` records a merged second source in `meta.md` (`also:`) so it matches `same` next time |
| `gaps` | none | Open and answered question counts per item, from `gaps.md` |
| `answer` | `--id --question --citation` | Marks the open gaps.md question `[답변됨]` with the citation of the answering material; the line stays |
| `foreign` | none | Lists files in `material/` the flow did not write |
| `ledger` | none | A workspace that keeps material as `sources/NN_프로젝트/A1….md`: lists each A-file as item `NN_프로젝트/A1`, its title and whether it is `written` |
| `ledger-log` | `--item --note` (opt. `--status --later-step`) | Appends one line under `## 이력` at the end of that ledger file, nothing above it touched; a note already there is `unchanged` |

`--status` (on `log` and `init`) is reserved for later steps: the script refuses it without `--later-step <name>`. Step 1 never passes either flag.

Re-run: `same` needs the same `--source` and `--title` as the first run, so keep the source file name and section stable. Copy the `source:` line of the item's `meta.md` and its title; a changed file name or section gives `ambiguous`, not `same`.
Per-part procedures: `references/parts.md`. Citation, evidence and matching: `references/citation-evidence-matching.md`.

## Rules

- (a) Only the given material is used; nothing is invented. Every filled part holds a short paraphrase plus a verbatim quote or pointer, cited `<file> + heading or line range` (a line range only when the text has no heading; with a heading, cite heading plus quote and no line numbers, which go stale when lines are added above); for pasted or chat text, a message index, timestamp or verbatim first-words quote.
- (b) Anything unknown goes to `gaps.md` as a question for the user and is never guessed.
- (c) In `result.md`, a figure with a unit or percentage needs an evidence citation; a figure the user flags as their own claim ("체감상", "내 기억으로는", "I estimate", or says so when handing over) is labelled `user-stated`; a figure with no citation in the handed material and no such flag is marked `근거 없음` and gets a gaps.md question for its source. A figure written plainly in the text, with no record and no flag, is the `근거 없음` case, even when the user wrote the whole text: `user-stated` needs words about the figure itself ("체감상", "I estimate"), never just authorship. A figure citing a document that was not handed over is also `근거 없음`, its question naming that document. `근거 없음` is the only missing-evidence marker.
- (d) On a re-run, `match` decides: `same` updates the parts in place and logs it in `history.md`; `new` runs `init`; `ambiguous` asks the user to pick merge or new, never a guess. An answer to a gaps question arrives as new material: the part is updated with its citation and `answer` marks the question `[답변됨]`. An answered question is never deleted.
- (e) Step 1 creates status `raw` and never changes status. Later steps own every other transition and name themselves with `--later-step`; each is logged in `history.md`.
- (f) Content stays in the language of the material. Personal or confidential data is kept as given and stored only in the user's project.
- (g) Foreign files in `material/` are left alone and listed in the summary.
- (h) The final summary lists items added or updated, the open gaps count taken from `gaps` (never counted by hand), and the foreign files.
- (i) A no-op run writes nothing, history.md included: when the handed material adds nothing to an item, edit no part, skip `log` and `answer`, and leave `index.md` as it is. Never rewrite an existing citation to fix drift or wording; a citation changes only when its line changes.

## Process

1. **Read** every handed file or pasted text in full. Split it into episodes (one problem → decision → result story each). No episode found → say so and stop.
2. **Identify** each episode: `id` from source and title, then `match`.
3. **Branch** on the result (rule d). Stop on `ambiguous` for that episode and ask; continue with the others.
4. **Fill** the seven parts per `references/parts.md`: `init` for `new`; for `same`, read the item's parts and compare the episode statement by statement, then add each statement the parts lack in place, cited. Apply rules (a)-(c) line by line. Write parts with the file tools (Write/Edit), never shell `echo` or heredocs: citations hold quotes and `#`, which break shell quoting. Re-read each file you wrote and check no line ends mid-citation. For each answered gaps question, `answer` it after the part is updated, with `--question` set to the open line exactly as it stands after `- `, `[part]` prefix included.
5. **Record**: `log` one note per item created or changed (source, what changed); skip it for an item that did not change (rule i). Never pass `--status`.
6. **Index and scan**: run `index`, then `foreign`.
7. **Summarize** per the template.

## Output Template

```
수집 결과 (<n>건 입력 → 추가 <a>, 갱신 <u>, 질문 대기 <q>)
- 추가: <id> — <title>
- 갱신: <id> — <what changed> (출처: <citation>)
- 병합/신규 선택 대기: <id> ↔ <candidate id> — <reason>
열린 빈칸: <count> (<id>: <question> ...)
foreign 파일: <paths or 없음>
다음 단계(이 skill 범위 밖): 글쓰기, 덱 렌더링, 피드백 반영
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Splits the material into episodes, runs `match`, fills parts with cited paraphrases | Hand over the material; keep file names and sections stable between runs |
| Marks unsourced figures and writes unknowns as gaps.md questions | Answer gaps by handing the answer as new material |
| Asks merge or new on `ambiguous` | Pick merge or new |
| Reports items, open gaps and foreign files | Move or remove foreign files yourself if you want them gone |

## Related Skills

- Neighbour: `portfolio:job-application-workflow` (the full application flow this feeds)
- Later steps, not done here: writing, deck rendering (`portfolio:deck-builder`), feedback loop-back
