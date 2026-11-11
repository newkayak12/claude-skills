# Workspace — the standard structure, in detail

Detail for `SKILL.md`. `scaffold` creates what is empty, never overwrites; the engine owns the formats below.

## Root and old names

Root holds only CLAUDE.md and the skeleton and deck pairs (`layout` warns on a `deck.*.mdx` conflict copy). Older names
(`skeleton.md`, `deck.mdx`, `resume.md`, `README.md`, `template/분석.md`, `template/다음렌더-지침.md`) are still read, listed by
`layout` as `legacy`, renamed by `scaffold`; then fix references in the workspace's notes. Tidying moves to `_archive/`;
only a proven copy is deleted; a name clash goes into a subfolder.

## The round's record folder: `snapshot/rounds/round-NN/`

Written by `round` (never overwriting a file). Files beside the record that already exist are copied in
(`rounds/feedback-N.md` → `feedback.md`); the rest are templates the round fills.

| File | Holds |
|---|---|
| `portfolio-skeleton.md` | the skeleton as that round left it |
| `feedback.md`, `feedback-before.json`, `feedback-after.json` | revision-mode feedback (previous vs this version) and its five-dimension scores |
| `pattern-a.json`, `pattern-b.json` | pattern two-version scores (`pattern-score.mjs`, fixed keys) |
| `compare.json` | the `compare` output of the two score sets |
| `noah.md` | the user-proxy verdict (`판정:` line required), written apart from the panel, every round; noah absent → the reason |
| `overrides.md` | what the user turned over (a finding or a default), with date |
| `report.md` | edits with reasons (below), verification, open questions |

`report.md` sections: `고친 것` (쪽 · 칸 · 이전 → 이후 · 출처 · 근거 파일 · 이유), `쓰지 않은 지적` (지적 · 출처 · 쓰지 않은 이유),
`기본값으로 정한 것`, `사용자가 정할 구조`, `검증`, `열린 질문`. 출처 is feedback priority, panel or noah; 근거 파일 is the
file the finding came from (`feedback.md` line, a material item, a score file). `검증` lines are filled with results:
screen check of the changed pages after a render, pptx text equals skeleton (`verify-build`), asset files, footnote
pairs, sentence agreement (`claims`). `round-check --round N` returns `unfilled` (files still templates) and `problems`
(an edit row without source, evidence or reason; an empty section or verification line; no `판정`). Fix problems,
or write the reason a part did not run ("렌더 안 함: 요청 없음"); an empty cell is never an answer.

## Frozen baseline: `stable/`

`snapshot --stable [--note …]` copies skeleton + deck source + resume sources (+ `style/`) into
`stable/<YYYY-MM-DD>-skeleton-v<ver>/`, files read-only, and appends `| 날짜 | 버전 | 메모 |` to `stable/README.md`
(skeleton, newest deck and resume snapshot versions). An existing folder is never overwritten. A round compares its
skeleton and scores against the newest baseline; an edit is never made inside `stable/`.

## `style/`

| File | Holds | Read by |
|---|---|---|
| `문체.md` | `## 규칙`; `## 내 문단`: the user's own paragraphs, never AI-edited text | rewrite, `write:like-me`, every sentence written |
| `표기규칙.md` | spacing, footnotes as numbered marks, captions | rewrite, deck build |
| `레이아웃.md` | `- top|bottom|left|right: <pt>` safe-area margins | `layout` (`safe_area`), `deck-builder` |
| `이력서-서식.md` | type and spacing table, header and photo, ATS/parser rules | `resume-builder` |

A value the user has not given stays empty and is asked once, never filled in.

## Records

- `consensus/<date>-<topic>.md`: a debate transcript kept as it was said; never edited or summarised in place.
- `decisions/NN-<topic>.md`: a decision and its reason, numbered in order.
- `docs/확인할-것.md`: `- [ ] 2026-03-01 · 3쪽 · question`. `questions --add --text … [--page N]` appends (a duplicate open
  question is not added twice); the user answers by writing ` → 답: …` and `[x]`; `questions --read` returns
  `{ open, answered }`. An answered question is used as a settled answer and not asked again.
- `analysis/`: a link to the user's raw archive outside the workspace. Read-only: never write into it, never copy it in.
  `layout` reports a link whose target is gone.

## Commands in CLAUDE.md and style/

Written without a plugin install path (no version folder): the guide says `manage.mjs scaffold` and the skill gives its
location. `layout` warns when CLAUDE.md or a `style/` file names `…/skills/<skill>/scripts/<file>` that does not exist.
