# Citation, evidence and matching rules

## Citation format

A citation points at the material so the user can find the line again.

| Source | Format | Example |
|---|---|---|
| A file | `<file> + heading or line range` | `retro.md + "## 에피소드 A"`, `retro.md + L12-14` |
| Pasted text or chat dump with no file | message index, timestamp, or a verbatim quote of the first words | `chat #7`, `[14:02]`, `"지난 분기에 캐시를…"` |

- Prefer the heading; use a line range only when there is no heading (line numbers shift when the source grows). Paths are as the user gave them (relative to the project root).
- A quote is verbatim: same characters, same language, no fixing of typos. A paraphrase never goes inside quote marks.
- A line you cannot cite is not written. Move it to gaps.md as a question.
- Several sources: cite each one used. A re-run adds the new source next to the old one, never in place of it.

## Evidence for figures

A figure is any number with a unit or a percentage (`40%`, `3초`, `12만 건`, `2주`).

1. Backed by a record inside the handed material (a measurement, table, report excerpt or dashboard note that is itself there) → the citation of that record is the evidence.
2. The user flags it as their own claim ("체감상 40%", "내 기억으로는", "I estimate", or says so when handing over) → cite the statement and label it `user-stated`.
3. Neither a record nor such a flag (a figure written plainly in the text) → `근거 없음` in the evidence column, plus a gaps.md question asking where it came from. That the user wrote the text is not a flag: `user-stated` needs words about the figure itself.

A document the user names but did not hand over is not evidence (hand it over as new material and a re-run cites it): cite the statement that names it and label it `user-stated`. Never repair a figure by inference, back-calculation or a "typical" value.

## Matching (item identity)

Run for every episode before writing, from the project root:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/material/scripts/material.mjs id --source <file-or-section> --title <episode title>
node ${CLAUDE_PLUGIN_ROOT}/skills/material/scripts/material.mjs match --id <id> --source <source> --title <title>
```

`--source` is the file, plus the section when one file holds several episodes (`retro.md#에피소드-A`); pasted text uses a short label (`chat-2026-10-18`). Keep it identical across runs so a re-run matches: for an existing item copy `source:` and the title from its `meta.md`; a new file name or section for the same episode yields `ambiguous`, not `same`.

| `result` | Do |
|---|---|
| `new` | `init`, then fill the parts. |
| `same` | Do not `init`. Update the parts in place, `log` the change. |
| `ambiguous` | Show the `candidates` (id, title, source, reason) and ask: merge into candidate X, or new item? Write nothing until answered. Merge = treat as `same` with the candidate's id; new = `init` under the new id. Never guess. |

`match` compares strings only; a renamed episode or the same episode from a second source shows up as `ambiguous`, not `same`. Do not judge sameness by meaning yourself; ask.

An answer to a gaps.md question is new material: run `match` on it against the item it answers (same source file as the item: `same`; otherwise ask), update the named part, cite the answer.

## Foreign files

`node ${CLAUDE_PLUGIN_ROOT}/skills/material/scripts/material.mjs foreign` lists anything in `material/` that is not `index.md` or one of the seven part files of an item folder. Never edit, move, delete or overwrite them; list them in the summary. If an `init` target id collides with one, `init` reports `exists`; treat it as `ambiguous` and ask.

## Data handling

Names, employers and figures are stored as given, only in the user's project (`material/`). Nothing is sent or written outside it, and nothing is masked or generalised unless the user asks.
