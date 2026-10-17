# knowledge — a second brain, not only a vault

Status: draft for the user's choice. No code. Backlog card 34.

Reference: https://github.com/coleam00/second-brain-starter (README + `templates/memory/`). Scope:
knowledge plugin only, judged by skill output quality. vault and noah are hand-built instances; this
doc cites none of their content, and the goal is that both could be rebuilt from knowledge skills.

Principles (user, 2026-10-16): "외부에 노출되는 스킬을 줄이고 내부적으로 진행하면 좋을 듯" and
"사용자는 내부를 모르고 편하게 써야만한다" — few entry skills, builders run inside them, and no skill,
stage or file name is something the person must know or say.

## 1. Reference piece → knowledge today

| Reference piece | knowledge today | Gap / extend |
|---|---|---|
| BOOTSTRAP.md (first-run interview writes SOUL/USER) | none | gap: a first-run step inside `workflow` |
| SOUL.md (persona, values, boundaries) | none | gap: one memory note type |
| USER.md (profile, preferences) | none | gap: one memory note type |
| MEMORY.md (decisions, lessons, active projects) | claim/relation notes in `base-builder`; competency questions gate | extend: decision and lesson as note kinds with date + source |
| daily/YYYY-MM-DD.md (session log) | none (`knowledge-delta-check.mjs` queues reindex only) | gap: append-only daily log, written by a hook |
| SessionStart loads memory | SessionStart hook exists (`ensure-trophy.sh` only) | extend: digest injection, command hook |
| PreCompact / SessionEnd capture | none | gap: command hooks writing raw captures |
| Hybrid search, 70% vector / 30% keyword | **exists**: `scripts/sqlite-knowledge.mjs` FTS5 word+trigram RRF, embeddings, `semantic 0.7 / lexical 0.3` with ollama; MCP `knowledge_search` | extend: memory notes in the index, a `kind` filter; default `hash` provider is lexical only |
| Heartbeat (scheduled gather → reason → notify) | none | gap; see §3 |
| Integrations, chat bot, VPS deploy | none | out of scope (not output quality) |
| Graph / visualization | `graph-builder`, `ontology-builder`, `render-graph-view` | knowledge is ahead here |

## 2. Entry points — two

Today all 8 skills carry `Use when` triggers, so each is a door the person can trip over.

| Entry (what the person says) | Skill | Runs inside it |
|---|---|---|
| "이거 기억해둬", "이 프로젝트 지식 정리해줘", "검색이 이상해" | `workflow` | first-run interview, `base-builder`, `ontology-builder`, `graph-builder`, `rag-corpus-builder`, `sqlite-index-builder`, memory distill, eval loop |
| "전에 이거 어떻게 정했지", "근거 달아서 알려줘" | `query` | index refresh if stale, memory + vault search, citations |
| (nothing) | command hooks | load digest at start, capture at compact/end |

Builders lose their trigger lines (description says they run from `workflow`), so routing lands
on the two entries. `render-graph-view` stays callable from `workflow` ("그래프로 보여줘").

## 3. Memory layer + session hooks — options

All three keep memory as Markdown the person can read, under the existing knowledge root, and keep
every hook a plain command hook that fails open (`compat-claude.md`); a mod is never required.

**A. Memory as a vault section, raw capture in hooks, distill in the skill.**
Memory notes (persona, profile, decision, lesson, daily) live beside the vault notes and use the
same validator and index. SessionStart prints a capped digest (profile + newest decisions).
PreCompact/SessionEnd append a raw excerpt to today's log — no model call in the hook. The next
`workflow` or `query` run distills pending captures into decision/lesson notes with sources.
- + reuses index, validator, delta hook; hooks are fast and testable; nothing unverified becomes a claim.
- − capture is raw until a skill runs; per-project only.

**B. A as above, plus a user-scope profile/persona store shared across projects.**
- + the profile follows the person; first-run interview happens once.
- − two roots to index and validate; privacy line between projects; more to explain.

**C. Hooks distill on their own (`claude -p` in SessionEnd).**
- + zero-effort; MEMORY is current at every start.
- − cost and latency per session, hook timeouts, nested headless runs, unreviewed claims written
  as memory — conflicts with the answerability gate.

Heartbeat, for any option: no daemon. At SessionStart the digest adds one "due" line (captures
waiting to distill, decisions past a review date). Scheduling stays with the client's own
`/loop` or `schedule` if the person asks.

## 4. Recommendation and order

Recommend **A**, then B's profile only if the person asks after using A. Phases, each one Sprint card:

| # | Phase | Done when (checkable) | Real run |
|---|---|---|---|
| 1 | Two entries | routing probe: 8 prompts (4 EN, 4 KR) land on `workflow`/`query`, 0 on a builder; `validate_plugins.py`, `check-skeleton.mjs` clean | fresh fixture repo, only "이 프로젝트 지식 정리해줘" → vault built, gate passes |
| 2 | Memory notes + first-run interview | `validate-knowledge.mjs` checks memory kinds (date, source); its tests pass with counts | empty dir: "기억해둬: X" → interview once, decision note with date and source |
| 3 | Session hooks | `node --test` on the hook script: digest ≤ cap, capture append-only, fails open, no output outside a knowledge root | two sessions: decision made in 1, digest shows it in 2 |
| 4 | Memory in search | `sqlite-knowledge` tests cover memory rows and `kind` filter; eval set has memory questions answered `complete` | "전에 X 어떻게 정했지" → cited decision note |
| 5 | Due line (heartbeat-lite) | digest test: due line appears only when captures wait or a review date passed | leave captures undistilled, next start shows the due line |

Rebuild check (closes the card): a capability list of vault/noah (inbox, log, decisions, search,
session start) mapped to phases 1-5 with none left unmapped — capabilities only, no content.

## 5. Open questions

1. **Scope of memory** — project-only (A) or also a user-scope profile (B)? Recommended: A now.
2. **How many entries** — two (`workflow` remember/build, `query` ask) or one? Recommended: two;
   asking and building read differently and one door makes the trigger vague.
3. **Who distills captures** — the skill on its next run (A) or the hook via `claude -p` (C)?
   Recommended: the skill; hooks stay fast and nothing unreviewed becomes memory.
4. **Persona note** — include SOUL-style persona, or only profile + decisions + lessons + log?
   Recommended: include it as one short optional note filled by the first-run interview.
