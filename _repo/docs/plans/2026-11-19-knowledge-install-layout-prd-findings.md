# F1 Install layout — findings (investigate:U1:1, 2026-11-19)

Feature area F1, card 158 (`_repo/docs/backlog.md:631-639`). Every finding cites the file it came from.
Anything no source settles is under "Unknowns", with an owner.

## Sources opened

| Source | What it settled |
|---|---|
| `knowledge/compose.yaml:1-41` | the services, the profiles, the mount lines, the build context |
| `knowledge/Dockerfile` | the image entrypoint, the default command, the `USER node` and `WORKDIR /workspace` lines |
| `knowledge/hooks/knowledge-delta-check.mjs:19-28,57-92,240-295,306` | the hook's markers, its resolver, the `_knowledge/{checks,reports,jobs}` writes, its exports |
| `knowledge/hooks/hooks.json:9` | how the hook is invoked (`node ${CLAUDE_PLUGIN_ROOT}/hooks/knowledge-delta-check.mjs`) |
| `knowledge/scripts/sqlite-knowledge.mjs:34,44-52,170-188,703,755,887,1606,1889,2130` | the script's resolver, `DEFAULT_DB`, `KNOWLEDGE_DB_PATH`, the callers, the export |
| `knowledge/servers/knowledge-mcp.mjs:5-17` | the MCP server takes its root from `--root` |
| `knowledge/README.md:113-122,225-231,404-411` / `knowledge/KOR.md:110-119,220-226,387-394` | the layout block today, the `.knowledge/knowledge.sqlite` mention, the docker command |
| `knowledge/skills/query/references/local-sqlite.md:17,140-164` | the docker docs, the `KNOWLEDGE_ROOT` example, "the bind-mounted vault receives `.knowledge/knowledge.sqlite`" |
| `knowledge/skills/base-builder/references/retrieval-layout.md` | no line mentions `.knowledge` or `knowledge-system` (grep found 0 matches) |
| `_repo/docs/backlog.md:631-639` | card 158's Why and Acceptance |
| `.claude/conventions/{boundaries,verification,coding}.md` | templates only; every project rule in them is an unfilled `<!-- fill -->`. Two lines are real: verification needs one end-to-end run; coding says "match the surrounding file's idiom" |
| `.claude/rules/repo.md`, `maintaining.md` (in prompt) | harness/ and graph/ are frozen; README and KOR move in the same commit; no version bump; Read/Edit/Write only |

## Findings — current behaviour

1. **compose mount** — the services `knowledge-index` (`compose.yaml:2-7`) and `knowledge-index-ollama` (profile `semantic`, `compose.yaml:9-27`) both mount `${KNOWLEDGE_ROOT:-..}:/workspace` (`compose.yaml:6`, `:14`). The service `ollama` (profile `semantic`, `:29-38`) mounts only the named volume `ollama-models` and no project path.
2. **Why `..` and `.` are wrong** — a relative host path in a compose `volumes` entry resolves against the project directory, which defaults to the compose file's own folder. From an installed copy (`~/.claude/plugins/cache/<market>/knowledge/<ver>/compose.yaml`), `..` therefore becomes `~/.claude/plugins/cache/<market>/knowledge/`, the plugin cache. A bare `.` would be the plugin version dir. Neither is the caller's cwd. The backlog states this behaviour (`backlog.md:632-634`). The resolution rule is Docker Compose's documented behaviour; I did not run compose in this stage (see checks).
3. **Build context must stay plugin-relative** — `build.context: .` (`compose.yaml:4,12`) correctly means the plugin dir, because the Dockerfile COPYs `scripts/sqlite-knowledge.mjs` and `servers/knowledge-mcp.mjs`. F1 changes the volume source only, not the build context.
4. **Container command** — every index service runs `index --root /workspace` (`compose.yaml:7,17-20`). The image's entrypoint is `node /opt/knowledge/scripts/sqlite-knowledge.mjs` with default CMD `status --root /workspace` (Dockerfile). Because the script's resolver nests (finding 6), mounting the *project* at `/workspace` still lands on `<project>/knowledge-system/` when that folder holds artifacts.
5. **Image user** — the Dockerfile sets `USER node`. A bind-mounted project owned by another uid may be unwritable for `.knowledge/`. Not verified (see unknown U-5).
6. **Script resolver** — `findKnowledgeRoot(inputRoot)` (`sqlite-knowledge.mjs:175-183`):
   - It returns `resolve(inputRoot)` if `hasArtifacts` (`:171-173`) holds there.
   - Otherwise it returns the first of `knowledge-system`, `knowledge-base`, `knowledge-artifacts` under it that has artifacts.
   - Otherwise it returns the input root unchanged.
   - Artifacts are the `INDEXED_ARTIFACT_KINDS` (catalog, chunks, nodes, edges) at `ARTIFACT_PATHS` (`:44-52`): `_knowledge/catalog.jsonl`, `_rag/chunks.jsonl`|`rag/chunks.jsonl`, `_graph/nodes.jsonl`|`graph/nodes.jsonl`, `_graph/edges.jsonl`|`graph/edges.jsonl`. `questions` is deliberately excluded (`:51-52` comment).
   - Callers: `buildIndex` (`:703-704`), `openIndex` (`:887-888`), `evalQuestions` (`:1606-1607`), `indexStatus` (`:1889-1890`). It is exported (`:2130`).
7. **DB path** — `DEFAULT_DB = '.knowledge/knowledge.sqlite'` (`:34`). `resolveDbPath` (`:185-188`) uses `--db`, then `KNOWLEDGE_DB_PATH`, then the default, resolved against the *resolved knowledge root*, not the input root. `buildIndex` creates the directory (`:755`). So `index --root <project>` writes `<project>/knowledge-system/.knowledge/knowledge.sqlite` when `knowledge-system/` holds the artifacts, which is what the backlog's scratch index saw (`backlog.md:634-635`).
8. **Hook resolver** — `findKnowledgeRoot(cwd, filePath)` (`knowledge-delta-check.mjs:69-92`):
   - It walks up from the edited file's dir while it stays inside `cwd`.
   - A dir is the root when `markerScore >= 2` or it has `_rag`/`_graph`. `markerScore` (`:61-67`) counts the `KNOWLEDGE_MARKERS` present (`:19-28`: knowledge-system-plan.md, vault-plan.md, index.md, _rag, _graph, _ontology, _knowledge, .knowledge) and adds +2 when the basename is `knowledge-system`.
   - The fallback is the first `knowledge-system` path segment.
   - It returns `{root, file}` or `null`. It is **not exported** (`:306` exports only `analyze, main`).
9. **The two resolvers disagree** (derived from findings 6 and 8):
   - The script nests into `knowledge-base`/`knowledge-artifacts` by artifact files. The hook knows only `knowledge-system` by name, and otherwise uses markers.
   - The script keys on files (`catalog.jsonl` etc.). The hook keys on dirs and markers, and includes `.knowledge` and `index.md`, which the script ignores.
   - The hook is bounded by `cwd`. The script is not.
   - Example: a `<project>/knowledge-base/` with `_knowledge/catalog.jsonl` but no second marker is found by the script, and by the hook only if a second marker is present.
10. **Delta hook outputs** — for each edited `.md` under a found root (skipping `_rag/`, `_graph/`), the hook writes under `<root>/_knowledge/` (`knowledge-delta-check.mjs:261-292`):
    - `checks/latest.json`
    - `reports/delta-checks.jsonl`
    - `jobs/` queues, written only when that delta is needed: `catalog-delta-queue.jsonl`, `answerability-check-queue.jsonl`, `embed-queue.jsonl`, `graph-update-queue.jsonl`, `ontology-review-queue.jsonl`

    The hook reads `_knowledge/catalog.jsonl` and `question-results.jsonl` (`:196-197`). It runs from `hooks.json:9` on tool use.
11. **Install creates nothing in the project** — none of hooks.json, the MCP server or compose writes anything at install time. The hook writes only after an edit to a `.md` under a found root (finding 10). The index writes only on `index` (finding 7). I found no install script; the plugin install itself only populates the cache dir. Inferred from these sources; nothing in the repo states it in so many words.
12. **MCP server root** — `servers/knowledge-mcp.mjs:5-17` takes `--root` from argv (`rootFromArgs`). F1's resolver decision affects it through the script functions it calls.
13. **README today** — README `:113-122` (KOR `:110-119`) shows a "Default output layout under `knowledge-system/`" code block. It has no `.knowledge/` row, no plugin cache row and no `_knowledge/{checks,reports,jobs}`. README `:225` (KOR `:220`) says "Builds `.knowledge/knowledge.sqlite`" with no base. README `:410` (KOR `:393`) shows `docker compose -f knowledge/compose.yaml run --rm knowledge-index`, a repo-checkout path that does not exist in an installed copy.
14. **Other docs that state the old behaviour** — `skills/query/references/local-sqlite.md:146-153`:
    - It runs compose with no `KNOWLEDGE_ROOT` ("From this repository").
    - It passes `KNOWLEDGE_ROOT=/absolute/path/to/vault` for a vault elsewhere.
    - `:164` says "the bind-mounted vault receives `.knowledge/knowledge.sqlite`".

    Under a `:?` rule the first command stops working. The card's request names only README/KOR, so this is unknown U-4.
15. **Tests today** — `scripts/sqlite-knowledge.test.mjs` has 45 `test(` calls. `hooks/knowledge-delta-check.test.mjs` has 8 (grep -c, not a run). `postgres-sync.test.mjs` and `validate-knowledge.test.mjs` also match R2's glob. There is no `*.test.mjs` for compose.
16. **Conventions** — `boundaries.md` and `verification.md` are unfilled templates. The only binding lines are "verified = commands pass AND the behaviour exercised end-to-end once" and "match the surrounding file's idiom". The frozen paths (harness/, graph/) come from `.claude/rules/repo.md`, not from boundaries.md.

## Findings — settled (decided, not open)

- **The compose rule in force is `${KNOWLEDGE_ROOT:?...}`.** The critique node for this run told template-fill to state it. Reasons:
  - `${PWD}` is the invoker's environment variable, not compose's. It is unset or stale under non-shell launchers (exec from node, sudo, some IDE tasks), and then it silently falls back to an empty or wrong mount.
  - `:?` fails loudly and names the variable.
- **Shared engine (R1)**: noah, genna and general projects use one engine. The root, ontology and link policy are config, and no instance name appears in engine code. User decision, session 2026-11-19 (brainstorm).
- **The other session decisions are settled and are not F1's**: knowledge_capture, optional Ollama, the hardware model pick, pgvector staging, and engine-side linking. User, 2026-11-19.
- **The config `root` key's name and place are F2's.** F1's resolver reads it. Area brief and critique.
- **The `findKnowledgeRoot(inputRoot)` signature stays stable**, because of its four callers plus the export (finding 6). Area brief.
- **Table columns and row order are fixed by the brief**:
  - Columns: path | created by | when | purpose.
  - Row order: plugin cache dir; project (nothing created on install); `knowledge-system/` tree; `.knowledge/` with `knowledge.sqlite`; `_knowledge/{checks,reports,jobs}`.
  - Reserved blocks: F2 (notes/, catalog.jsonl, config), F3 (_graph/*.jsonl, hardware probe file), F4 (migrate/status artefacts).

## Requirements analysis

### Actors
- **Plugin user**: installs `knowledge` from the marketplace. The plugin lands in `~/.claude/plugins/cache/<market>/knowledge/<ver>/`. They run compose or the script from a project dir.
- **Instance owner** (noah, genna, a general project): points the same engine at their own root through config (R1).
- **Delta hook**: runs on tool use and writes `_knowledge/{checks,reports,jobs}` under the root it resolves.
- **Implementer and tester** of the F1 package.

### Rules
- R-a: compose never mounts the plugin dir. Every service that mounts a project uses the single line `${KNOWLEDGE_ROOT:?<message>}:/workspace`. That covers `knowledge-index`, `knowledge-index-ollama` (semantic), and any F3 profile. The `ollama` service mounts no project.
- R-b: `build.context: .` stays as it is (finding 3).
- R-c: One resolution rule serves the hook and the script. The script signature `findKnowledgeRoot(inputRoot)` is unchanged.
- R-d: The DB lives at `<resolved root>/.knowledge/knowledge.sqlite` unless `--db` or `KNOWLEDGE_DB_PATH` is given (finding 7).
- R-e: README.md and KOR.md carry the same table and change in one commit (R3).
- R-f: Verification runs from a cache-shaped copy under tmp/ and is cleaned afterwards (R4).

### Items (findings ids; the PRD assigns its own)
- **F1-AC-1** (compose):
  - `docker compose -f tmp/<cache-copy>/compose.yaml config` with `KNOWLEDGE_ROOT` unset exits non-zero, and its message names `KNOWLEDGE_ROOT`.
  - With `KNOWLEDGE_ROOT=<tmp project>`, every volume source of every service in every profile (`--profile semantic`, plus any F3 profile) is the project path and never the cache copy path.
- **F1-AC-2** (resolver):
  - Node tests cover both entry points on the same fixtures: a root with artifacts, nested `knowledge-system/`, `knowledge-base/`, `knowledge-artifacts/`, a root with none, and a configured `root`.
  - Each fixture resolves to the same dir from the hook (via an edited file under it) and from the script.
  - The existing 45 + 8 tests stay green.
- **F1-AC-3** (table):
  - README.md and KOR.md hold a table with the four columns and the five rows in order, followed by the reserved F2/F3/F4 blocks.
  - The rows match between the two files (grep), and both files are in one commit.
  - The stale README `:225`/`:410` lines (KOR `:220`/`:393`) are corrected.
- **F1-AC-4** (scratch):
  - Copy the plugin into `tmp/.../plugins/cache/<market>/knowledge/<ver>/` and build a tmp project with a `knowledge-system/` tree.
  - Run `node <copy>/scripts/sqlite-knowledge.mjs index --root <project>` and one hook invocation.
  - `find` lists exactly F1's rows: `knowledge-system/.knowledge/knowledge.sqlite` and `_knowledge/{checks,reports,jobs}/...`. Nothing is created in the cache copy, and nothing in the project outside these.
  - tmp/ is removed afterwards.

### Open questions (also in unknowns[])
U-1 … U-6 below.

## Unknowns (no source reached answers these)

- **U-1, shared module or twin code** (owner: implementation lead, F1 package). Recommended option: a shared `knowledge/scripts/knowledge-paths.mjs` that the hook imports, because both run from the same plugin dir (`hooks.json:9` uses `${CLAUDE_PLUGIN_ROOT}`). The other option is the same logic kept in both files. A shared module touches `check-copies.mjs`'s view only if a vendored copy exists; none was found.
- **U-2, what "agree" means for the hook's walk-up** (owner: implementation lead). Options:
  - (a) The hook walks up to the first dir whose script-resolution yields artifacts, plus the `knowledge-system` name fallback.
  - (b) The script also accepts the hook's markers.

  The critique asked for a default in story acceptance: (a), keeping the `cwd` bound.
- **U-3, config `root` key** (owner: F2 PLAN, F2-dependency). Its file name, its location and its precedence against `--root` and `KNOWLEDGE_ROOT` are F2's. F1 reads it through the resolver.
- **U-4, docs beyond README/KOR** (owner: PO). Do `skills/query/references/local-sqlite.md:140-164` and the README/KOR docker command follow the new rule in F1? Recommended: yes, same package, since `:?` breaks the documented no-variable command.
- **U-5, writability under `USER node`** (owner: implementation lead). Unverified: is a bind-mounted project owned by uid≠1000 writable? Options:
  - pass `user: "${UID}:${GID}"`, which reopens the env-var question
  - document the requirement
  - leave it and record it if the scratch run passes
- **U-6, F3/F4 rows** (owners: F3 PLAN, F4 PLAN). Which files F3's profile and probe write, and what F4's migrate/status leave on disk. F1 reserves the blocks only, and integrate checks the full table.
- **U-7, compose `config` on this machine** (owner: tester). The compose resolution rule is cited from Docker's behaviour and the backlog's 2026-11-19 observation. This stage did not execute compose.
  - investigate:U1:2 re-read `compose.yaml:1-41`, `sqlite-knowledge.mjs:170-188`, `knowledge-delta-check.mjs:69-71` and `README.md:225`/`KOR.md:220`. Every citation above still matches. `docker` is installed (`/snap/bin/docker`). A `docker compose config` run from a cache-shaped tmp/ copy was refused approval in this stage, so U-7 stays open for the F1 package's scratch run (F1-US-4).
