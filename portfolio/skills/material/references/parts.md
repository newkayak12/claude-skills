# Parts — what goes in each file of `material/<id>/`

`init` creates the seven files with Korean headings. Fill them from the handed material only.
Content language = the material's language. Citation form: see `citation-evidence-matching.md`.

Every filled line = a short paraphrase + a verbatim quote or pointer, e.g.

```
- 캐시 미적용으로 목록 조회가 느렸다. — "목록 API가 매번 DB를 전부 스캔했다" (retro.md + "## 에피소드 A", L12-14)
```

A part with nothing in the material stays at its heading; the missing piece becomes a gaps.md question.

| File | Heading | Holds | Never holds |
|---|---|---|---|
| `meta.md` | 메타 | `key: value` lines: title, status, source, period, role, tags. Set by `init` flags from what the material states. | A period, role or tag the material does not state: leave the value empty and ask in gaps.md. `status:` is `raw` from `init`; step 1 never changes it (`log --status` and `init --status` are reserved for later steps and need `--later-step`). |
| `problem.md` | 문제 | Situation, what was wrong, who was affected, constraints, the user's role in it. | Causes the material does not name. |
| `decision.md` | 결정 | Options considered, what was chosen, the reason given, who decided. | A reason or alternative the material does not give. |
| `result.md` | 결과 | One row per figure in the table (number / evidence source / label), then a line of non-numeric outcomes with citations. | Any figure without a label: see rule below. |
| `learned.md` | 배운 점 | What the user says they learned or would do differently. | Lessons inferred by Claude. |
| `gaps.md` | 빈칸 (질문) | One question per line, addressed to the user, each naming the part it blocks: `- [result] 40% 단축은 무엇을 기준으로 측정했나요?` | Guesses, "probably". An open question stays open until an answer arrives as new material; then it is marked, not deleted (see below). |
| `history.md` | 이력 | Dated lines written only by `log`. | Hand-edited lines. |

## result.md rule

Each figure with a unit or percentage gets a row:

| Situation | evidence source column | label column |
|---|---|---|
| The material cites a measurement, doc or section | the citation | (empty) |
| The user states it with no document behind it | the citation of the statement | `user-stated` |
| Neither | `근거 없음` (the only missing-evidence marker) | (empty); add a gaps.md question for the source, always |

Never round, convert or recompute a figure; copy it as written.

## gaps.md — when to ask

Add a question when: a cause, reason, number's baseline, date, role or outcome is implied but not stated; two statements conflict; a figure has `근거 없음`. Ask once per gap; before adding, read the file to avoid a duplicate.

## Filling and updating

- New item: `init`, then fill problem → decision → result → learned → gaps in that order, then `index`.
- Update (same item): edit the touched lines in place. Keep earlier lines unless the new material contradicts them; then keep both, cite both, and add a gaps.md question. Add the new citation to every line you change.
- Answer to a gaps.md question: put the answer in the part named in `[brackets]`, cited to the new material. Then run `answer --id <id> --question "<the question text>" --citation "<citation>"`. The question line stays visible, rewritten as `- [답변됨] [result] <question> — 답변: <citation>`; it is never deleted. Questions without an answer stay open.
- After any create or update: `log --id <id> --note "<what changed, from which source>"`. Never pass `--status`: step 1 does not change it.
- Identical material that adds nothing: edit nothing, `log` nothing. A no-op run writes nothing, history.md included.
