---
name: like-my-code
description: >-
  Use when a repo's own code style must become written policy — harness conventions (coding.md, boundaries.md)
  backed by repo evidence and Clean Code-class sources. Triggers: "내 코드 스타일로 컨벤션 뽑아줘",
  "이 레포 스타일을 정책으로", "like my code", "extract conventions from this repo".
license: MIT
metadata:
  version: "0.1.0"
scenarios:
  - "이 레포 코드 스타일 분석해서 하네스 컨벤션으로 만들어줘"
  - "참고 프로젝트 하나 줄 테니 그 스타일을 우리 개발 정책으로 써줘"
  - "Turn this repo's code style into harness conventions"
  - "Extract coding conventions from ~/work/api with sources for each rule"
compatibility:
  optional:
    - think-tool        # deciding whether a pattern is a habit or an accident
  remote_mcp_note: >-
    think-tool이 있으면 관찰한 패턴이 반복되는 습관인지 우연인지 가를 때 씁니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER write a rule the repo doesn't show. Each positive rule needs ≥2 `file:line` examples from ≥2 files and a consistency ratio; absence/boundary rules ("never imports", "append-only") carry a violation count or commit evidence plus one `file:line` example.
- A pattern below 70% consistency, or seen in fewer than 3 files, is *uncertain* — listed, not written.
- ALWAYS cite from `references/sources.md` only. No fitting source → `repo-only`. Never cite a book or item from memory.
- NEVER adopt a habit that contradicts a cited source silently — it goes under *Conflicts*; the user decides keep or drop.
- NEVER sample generated, vendored, or fixture code. Formatter/linter configs in the repo outrank counted habits.
- NEVER overwrite a filled line in an existing convention file. Fill `<!-- fill -->` placeholders and append; show the diff.
- Cite a section only when its title in `sources.md` names the rule's topic (naming → `CC ch.2`, function size → `CC ch.3` / `RF Long Function`, layer imports → `CA ch.22`, indent/line length/spacing → `CC ch.5`, comments → `CC ch.4`, errors → `CC ch.7`, class size → `CC ch.10`; semicolons, quotes and other syntax → the language guide). Language-bound sources (EJ and every guide row) cite only for code in that language. A stretched fit is `repo-only` — never launder a habit through a loosely related source.
- Rules are checkable: "functions ≤ 30 lines (91% of 212)", not "functions are short".
- Every count comes from a command you ran (grep, a script), never an estimate; a rule whose topic no section title names (e.g. guard clauses) is `repo-only`.

# Like My Code

## Process

**1. Collect.** Source repo (default: current project) · optional sub-path · target dir for the policy
(default: `<current project>/.claude/conventions/`). Source ≠ target is fine — a reference project's
style can govern a new one.

**2. Sample.** Recently touched hand-written files: `git log --since=6.months --name-only`, drop
generated/vendor/test-fixture paths, keep up to ~40 files across modules. Read formatter and lint configs
(`.editorconfig`, `ktlint`, `detekt.yml`, `.eslintrc*`, `ruff.toml`, …) first — they are rules already.

**3. Observe.** Count, per dimension, what the samples do:

| Dimension | Count |
|---|---|
| Naming | type/function/variable shapes, predicate prefixes, banned noise words, test naming |
| Functions | length distribution, parameter count, early return vs nested |
| Errors | exceptions vs result types, custom error hierarchy, swallowed catches |
| Comments | ratio, what they explain (why vs what), doc-comment coverage on public API |
| Structure | one type per file, package-by-feature vs by-layer |
| Dependencies | import direction between layers/modules, who may import framework code |
| Boundaries | generated dirs, append-only paths (migrations: never edited after add), co-change pairs (files that change together in ≥80% of commits) |

**4. Cite.** For each rule ≥70%, attach the source from `references/sources.md` that states it
(`[CC ch.3]`, `[RF Long Function]`, `[CA ch.22]`, `[KT naming rules]`). A rule the source contradicts
→ *Conflicts* with both sides quoted.

**5. Show the draft.** Rules, uncertain, conflicts — the user edits before anything is written.

**6. Write.** `coding.md` gets Naming & structure / Style / Dependencies; `boundaries.md` gets its three
lists: *Do not modify without explicit user approval*, *Off-limits entirely* (generated/vendored dirs),
*Requires a dependent update when changed*. Missing file → create from the harness template headings. Report the diff.

## Output Template

```
Source: <repo>@<sha> · N files sampled · configs: .editorconfig, detekt.yml
Target: <dir>/.claude/conventions/

coding.md
## Naming & structure
- Predicates start with is/has/can — 94% (118/125) · ex: src/a/Order.kt:42, src/b/User.kt:17 · [CC ch.2]
## Style
- Functions ≤ 30 lines — 91% (193/212) · ex: … · [RF Long Function]
## Dependencies
- domain/** never imports infra/** — 100% (0 violations / 64 files) · ex: src/domain/Order.kt:3, src/domain/User.kt:5 (imports) · [CA ch.22]

boundaries.md
## Do not modify without explicit user approval
- db/migration/** — append-only (0 edits after add in 38 files) · ex: db/migration/V12__add_user.sql:1 · repo-only
## Off-limits entirely
- src/generated/** — generated (header "DO NOT EDIT") · ex: src/generated/Api.kt:1 · repo-only
## Requires a dependent update when changed
- api/openapi.yaml ↔ src/api/** — co-changed in 88% of commits · ex: a1b2c3d, e4f5a6b · repo-only

Uncertain: [pattern — ratio — why not a rule]
Conflicts: [habit + ratio] vs [source says] — keep or drop?
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Samples, counts, cites only from sources.md, separates uncertain and conflicts | Names the source repo and target |
| Shows the draft before writing; fills placeholders without overwriting | Edits the draft; decides each conflict |
| Writes coding.md / boundaries.md and reports the diff | Commits the convention files |

## Related Skills

- `develop:clean-code` — reviews code against these conventions; its references explain each dimension
- `develop:clean-architecture` — the dependency rule behind the Dependencies section
- `harness:install` — scaffolds the empty convention files this skill fills
- `write:like-me` — the same idea for prose
