# PRD F1 — Install layout (card 158)

Findings: `_repo/docs/plans/2026-11-19-knowledge-install-layout-prd-findings.md` (cited as "findings N").

## Goal

A person who installs the knowledge plugin (it sits in `~/.claude/plugins/cache/<market>/knowledge/<ver>/`) and runs its docker compose from a project gets that project indexed, never the plugin cache. One root-resolution rule serves the hook and the script. README.md and KOR.md show one table of where every file lives.

## Problem

Card 158 (`_repo/docs/backlog.md:631-639`) is one backlog item. Its four stories below split that one item by concern; the item is not duplicated.

- Compose mounts `${KNOWLEDGE_ROOT:-..}:/workspace` at `knowledge/compose.yaml:6` (knowledge-index) and `:14` (knowledge-index-ollama, profile `semantic`). Compose resolves a relative host path against the compose file's folder, so from an installed copy `..` is `~/.claude/plugins/cache/<market>/knowledge/`, the plugin cache (findings 1, 2). A bare `.` is the version dir. Neither is the caller's cwd.
- Two resolvers disagree (findings 6, 8, 9). The hook's `findKnowledgeRoot(cwd, filePath)` (`knowledge/hooks/knowledge-delta-check.mjs:69-92`) walks up from the edited file, bounded by cwd, and scores markers; it is not exported (`:306`). The script's `findKnowledgeRoot(inputRoot)` (`knowledge/scripts/sqlite-knowledge.mjs:175-183`) checks the root, then `knowledge-system`, `knowledge-base`, `knowledge-artifacts` by artifact files; callers at `:703`, `:887`, `:1606`, `:1889`; export at `:2130`.
- README says `.knowledge/knowledge.sqlite` without its base (`knowledge/README.md:225`, `knowledge/KOR.md:220`). The real path is `<project>/knowledge-system/.knowledge/knowledge.sqlite` (`sqlite-knowledge.mjs:34,185-188`, finding 7). README `:410` / KOR `:393` show a repo-checkout compose path. `skills/query/references/local-sqlite.md:146-164` documents compose without `KNOWLEDGE_ROOT` (finding 14).
- The compose resolution rule is Docker's documented behaviour plus the backlog's observation; it has not been run on this machine yet (unknown U-7).

## Scope

1. Compose rule (F1-US-1). 2. Root resolution (F1-US-2). 3. README.md + KOR.md layout table (F1-US-3). 4. Scratch verification from a cache-shaped copy under tmp/ (F1-US-4). Also in scope (default - revisit with PO): `skills/query/references/local-sqlite.md:140-164` and the README/KOR docker command follow the new rule.

Decisions taken as rules:

- **Compose rule: refuse without a root** `${KNOWLEDGE_ROOT:?KNOWLEDGE_ROOT must be the project to index}` (default - revisit with user). `${PWD}` is rejected: it is the invoker's shell variable, can be unset or stale under non-shell launchers, and then mounts silently wrong; `:?` fails loudly and names the variable (findings, settled section).
- **Published for F3's profile to reuse**: the root variable is `KNOWLEDGE_ROOT`; the mount line is `${KNOWLEDGE_ROOT:?KNOWLEDGE_ROOT must be the project to index}:/workspace`. Every service that mounts a project uses exactly this line; `ollama` mounts only its named volume. `build.context: .` stays (the Dockerfile COPYs from the plugin; finding 3).
- **Resolver: one shared module** `knowledge/scripts/knowledge-paths.mjs`, imported by the hook and the script (default - revisit with implementation lead). The hook walks up from the edited file to the first dir where the script's rule finds artifacts, keeping the cwd bound and the `knowledge-system` name fallback (default - revisit with implementation lead).
- `findKnowledgeRoot(inputRoot)` keeps its signature and its export (callers `:703`, `:887`, `:1606`, `:1889`).
- The config `root` key's file, name and precedence are defined by F2; F1's resolver reads it from there.

## User stories

### F1-US-1 — Card 158: compose never mounts the plugin cache; it refuses to start without a project root

As a plugin user running compose from my project, I get my project indexed, or a clear refusal.

**Acceptance**
- A1.1: compose never mounts the plugin directory: it refuses to start without a project root or defaults to the caller's cwd
  - Chosen branch: refuse. From a cache-shaped copy under tmp/, `KNOWLEDGE_ROOT` unset, `docker compose -f <copy>/compose.yaml config` exits non-zero and the message names `KNOWLEDGE_ROOT`.
  - With `KNOWLEDGE_ROOT=<tmp project>`, `docker compose -f <copy>/compose.yaml config` and again with `--profile semantic` (and each profile F3 adds) show every `volumes` source as the project path; the copy's own path appears in no volume source (only as `build.context`).
  - `grep -n 'KNOWLEDGE_ROOT' knowledge/compose.yaml` shows `:?` on every project mount line (currently `:6`, `:14`) and no `:-` default.
  - The root variable and the `/workspace` mount line above are written in compose.yaml and in the README table's notes for F3 to reuse.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고")
  - applied: compose names no instance; the root comes only from `KNOWLEDGE_ROOT`. `grep -ni 'noah\|genna' knowledge/compose.yaml` finds nothing.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
  - Run the three commands and report each count (today 45 + 8 `test(` calls in the two main suites; finding 15); plus `docker compose config` results above, verification per `.claude/conventions/verification.md` (commands pass and the behaviour exercised once end to end).
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
  - applied: no `plugin.json`/marketplace change; compose docs edited in README and KOR in one commit.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded
  - applied: compose is checked from an installed-cache-shaped copy (`tmp/.../plugins/cache/<market>/knowledge/<ver>/`), never the repo checkout; tmp/ removed after the result is recorded.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched
  - applied: `git diff --stat` shows no path under `harness/` or `graph/` (frozen, `.claude/rules/repo.md`; `.claude/conventions/boundaries.md` is an unfilled template, so the rule comes from repo.md).

### F1-US-2 — Card 158: one root-resolution rule for the hook and the script

As an instance owner, the delta hook and `sqlite-knowledge.mjs` find the same knowledge root for the same project.

**Acceptance**
- A1.1: compose never mounts the plugin directory: it refuses to start without a project root or defaults to the caller's cwd
  - Compose mounts the project at `/workspace`; `index --root /workspace` resolves through the shared rule, so a project holding `knowledge-system/` with artifacts lands on `/workspace/knowledge-system` (finding 4).
- Resolution rule (the card's own criteria, F1-AC-2):
  - `knowledge/scripts/knowledge-paths.mjs` holds the logic; the hook imports it; the script keeps `findKnowledgeRoot(inputRoot)` with an unchanged signature and export (`sqlite-knowledge.mjs:2130`) so `buildIndex`, `openIndex`, `evalQuestions` and `indexStatus` need no edit.
  - The hook walks up from the edited file to the first dir where the script's rule finds artifacts, bounded by cwd, with the `knowledge-system` name fallback.
  - The config `root` key is read by this resolver from the place F2 defines; F1 does not define its file, name or precedence.
  - Node tests run both entry points on the same fixtures: root with artifacts, nested `knowledge-system/`, `knowledge-base/`, `knowledge-artifacts/`, a root with none, and a configured `root` (the last once F2 lands). Both give the same dir. The existing suites stay green: `node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs`, counts reported.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고")
  - applied: the root comes from `--root`, `KNOWLEDGE_ROOT` or config; `grep -ni 'noah\|genna' knowledge/scripts knowledge/hooks` finds nothing in the resolver.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
  - Run all three; report counts. The new module is checked by `check-copies.mjs` if it is vendored anywhere (none found, findings U-1).
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
  - applied: no bump; any README/KOR line on resolution changes in both.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded
  - applied: fixtures are built under tmp/; removed afterwards.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched
  - applied: the edits are `knowledge/` only; harness/ and graph/ untouched.

### F1-US-3 — Card 158: README.md and KOR.md carry one layout table

As a plugin user, I read where every file lives, with the full DB path.

**Acceptance**
- A1.2: README.md and KOR.md (same commit) carry one table: plugin cache dir, project (nothing created on install), knowledge-system/ tree, .knowledge/ DB location, _knowledge/{checks,reports,jobs} from the delta hook
  - Columns, fixed: path | created by | when | purpose.
  - Rows, fixed order: (1) plugin cache dir; (2) project (nothing created on install); (3) `knowledge-system/` tree; (4) `.knowledge/` with `knowledge.sqlite`, shown as `<project>/knowledge-system/.knowledge/knowledge.sqlite`; (5) `_knowledge/{checks,reports,jobs}` from the delta hook (`checks/latest.json`, `reports/delta-checks.jsonl`, `jobs/*-queue.jsonl`, written only after a `.md` edit under a found root; findings 10).
  - After row 5, reserved blocks, in order, headed in the table and left to their areas: F2 (`notes/`, `catalog.jsonl`, config), F3 (`_graph/*.jsonl`, hardware probe file), F4 (migrate/status artefacts). Each area fills its own rows in the same four columns.
  - `grep` finds the same five row paths in README.md and KOR.md; `git show --stat HEAD` lists both files in one commit.
  - Stale lines corrected: README `:225` / KOR `:220` (base added), README `:410` / KOR `:393` (compose command with `KNOWLEDGE_ROOT`), and `skills/query/references/local-sqlite.md:146-164`.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고")
  - applied: the table uses `<project>` and generic names; no instance name.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
  - Run all three; report counts. A doc-only change needs the validator and check-copies at minimum.
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
  - applied: both files in one commit; no bump.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded
  - applied: the table's rows are checked against the tmp/ scratch run (F1-US-4).
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched
  - applied.

### F1-US-4 — Card 158: a tmp/ scratch project proves F1's rows

As a tester, I check that what is on disk is what the table names, from a copy placed like an installed cache.

**Acceptance**
- A1.3: a scratch project in tmp/ indexed with scripts/sqlite-knowledge.mjs produces exactly the files the table names
  - Copy the plugin to `tmp/<run>/plugins/cache/<market>/knowledge/<ver>/`; build `tmp/<run>/project/` with a `knowledge-system/` tree holding artifacts.
  - Run `node <copy>/scripts/sqlite-knowledge.mjs index --root tmp/<run>/project` and one hook invocation on an edited `.md`.
  - `find tmp/<run>/project` lists F1's rows only: `knowledge-system/.knowledge/knowledge.sqlite` and `_knowledge/{checks,reports,jobs}/...`; `find` on the cache copy shows nothing new.
  - Only F1's own rows are checked here. The check that the full table (F2, F3, F4 rows included) matches the disk belongs to integrate.
  - Run the compose rule checks of F1-US-1 from the same copy; record whether `.knowledge/` is writable under `USER node` for a bind mount of another uid (default - revisit with implementation lead: record the result if the run passes and document the uid requirement).
  - tmp/ is removed after the result is recorded.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고")
  - applied: the scratch project is generic.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
  - Run all three; report counts, and the scratch run's file list.
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
  - applied: no bump; the table checked is the one in both files.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded
  - applied: this story is that rule; the copy is cache-shaped, never the repo checkout.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched
  - applied: fixtures are written with Write; Bash only runs commands.

## Out of scope

- The capture tool (`knowledge_capture`, card 159, F2).
- Graph extraction and the hardware probe (card 160, F3). F1 publishes the root variable and the mount line; F3 adds its profile using them.
- The backend seam, migrate, status size advice and pgvector (cards 161/162, F4).
- Any version bump (batched release).
- Defining the config file or its `root` key (F2).
- Changing `harness/` or `graph/`, and changing `build.context`.
- Any source change in this planning run.

## Open questions

- Is a shared `knowledge/scripts/knowledge-paths.mjs` better than the same logic in both files? — owner: implementation lead (F1 package). Written above as the rule (default - revisit).
- What does 'agree' mean for the hook's walk-up? — owner: implementation lead. Written above as the rule (default - revisit).
- What is the config root key's file, name, and precedence against --root and KNOWLEDGE_ROOT? — owner: F2 PLAN (dependency). F1's resolver reads it; its fixture waits for F2.
- Does F1 also update skills/query/references/local-sqlite.md:140-164, which documents compose without KNOWLEDGE_ROOT? — owner: PO. Written above as yes (default - revisit).
- Can USER node (uid 1000) in the image write .knowledge/ into a bind-mounted project owned by another uid? — owner: implementation lead. Recorded by the scratch run.
- Which files do F3's profile and hardware probe, and F4's migrate/status, write on disk? — owners: F3 PLAN and F4 PLAN (dependency); integrate checks the full table.
- Does `docker compose config` on this machine confirm that `..` resolves to the compose file's parent and that `:?` fails naming the variable? — owner: tester (F1 package scratch run).
