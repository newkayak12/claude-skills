# 12. Rule Layering

`06-rules.md` holds only *global invariants + defaults*. In practice, *user style*, *project conventions*, and *per-cycle temporary exemptions* are also needed. When conflicts arise, they are resolved **by declared layer — not by interpretation**.

## §1. 4-Layer Structure

| Layer | Location | Examples | Scope |
|---|---|---|---|
| **L0 Core (invariant)** | `06-rules.md` *(Scope: invariant)* | Kill criteria, hypothesis immutability, Gate score formula | All cycles and projects — **cannot be overridden** |
| **L0 Default** | `06-rules.md` *(Scope: default)* | WIP=1, cycle 14-day cap | All cycles and projects — L1/L2/L3 can override |
| L0.5 Situational | `situational-rules/*.md` | security, data, ops, cognitive, self-discipline | Loaded when triggered |
| **L1 User** | `~/.harness/user-rules.md` | "Python: ruff+black", "functional-first" | All projects for this user |
| **L2 Project** | `<project>/.harness/project-rules.md` | "Postgres only", "DDD 4-layer enforced" | This project only |
| **L3 Cycle** | `cycles/<id>/exemptions.md` | "WIP=2 this cycle only" | This cycle only — **expiry date required** |

## §2. Conflict Resolution

**Priority**: `L3 > L2 > L1 > L0 Default`. `L0 Core (invariant)` sits above all layers — **cannot be overridden under any circumstances**.

### Core Principle: *No Interpretation*

When a conflict occurs, do not debate *which rule is more accurate*. Resolve by **declared layer only**.

```
Conflict example                                     Result
────────────────────────────────────────────────────────────
L0 Default: WIP=1                          → L3 applies (WIP=2)
L3 Cycle:   WIP=2 (expires 2026-06-15)

L1 User:    Python indent = 4 spaces       → L2 applies (tab)
L2 Project: Python indent = tab

L0 Core:    hypothesis immutability        → L0 Core applies (request rejected)
L3 Cycle:   request to modify hypothesis
```

### Conflict Within the Same Layer

Not resolved automatically. **Explicit decision required**:
- User intervenes → *promotes* or *merges* one of them
- If Claude chooses arbitrarily → triggers AP-26 (Layer auto-interpretation)

## §3. Rule Metadata Requirements

Every rule entry must carry the following frontmatter:

```yaml
---
id: R-XX-NN
scope: invariant | default
layer: L0 | L0.5 | L1 | L2 | L3
stage: Macro | Meso | Micro | * | post-launch
sunset: YYYY-MM-DD    # required for L3 only
pointer: <config-file-path>   # required for code style rules (§5)
---
```

A rule without this metadata is treated as *an invalid rule* — `rules-load.py` will refuse to parse it.

## §4. L0 Core (Invariant) Candidates

A rule is **invariant** if it meets any of the following:

1. **Kill criteria trigger conditions** — 3 re-entries / 200% time / 100% budget
2. **Hypothesis immutability** — no modification after registration (physically enforced via hash chain)
3. **Gate score formula** — the summation formula in `08-pass-criteria.md §1`
4. **ADR Status one-way** — only `Proposed → Accepted → Superseded` is allowed
5. **L3 without sunset prohibited** — expiry date enforced

These 5 are exempt-proof for *any user, project, or cycle*. Exemption requests are automatically rejected with a reason stated.

All other rules (the remainder of `06-rules.md`) are **default** — can be overridden at L1/L2/L3 with legitimate justification.

## §5. Code Style Belongs in Tool Pointers

**Do not write style directly in rule markdown**. It drifts.

Instead, L1/L2 rules specify *only the config file location*:

```markdown
## R-USER-FMT01: Python formatter
Layer: L1
Scope: default
Pointer: pyproject.toml [tool.black]
Hook: hook-formatter-config-exists
Why: Style enforcement is the toolchain's job. The harness only verifies that the config exists.
```

### Why This Approach

- Markdown rules *drift* — they diverge from code
- Real enforcement is done by *pre-commit + CI*
- The harness only checks *"is the linter configured?"*

### Candidate Tools

| Language / Target | Tool | Config file |
|---|---|---|
| Python | black, ruff, mypy | `pyproject.toml` |
| JS/TS | biome, eslint, prettier | `biome.json` / `.eslintrc.*` |
| Go | gofmt, golangci-lint | `.golangci.yml` |
| Rust | rustfmt, clippy | `rustfmt.toml` / `clippy.toml` |
| Commit messages | conform, commitlint | `.conform.yaml` |
| Git hook | pre-commit | `.pre-commit-config.yaml` |

Harness hooks check *file existence only*. Content is the toolchain's responsibility.

## §6. L3 Cycle Exemption Rules

`cycles/<id>/exemptions.md` holds *temporary exemptions only*.

### Required Fields

```yaml
---
target_rule_id: R-LP01           # rule being exempted
reason: Emergency security patch + parallel validation cycle   # one-line rationale
sunset: 2026-06-15               # cannot exceed the cycle end date
promotion_review: false          # whether to review L2 promotion in the next cycle
---
```

### Repeated Exemptions Are Promoted

If an L3 exemption for the same rule occurs *2 consecutive cycles* → **L2 promotion review is forced**. This prevents disguising permanent exemptions as temporary ones (AP-30).

### Expiry Handling

- `sunset` date reached → automatically expires (invalidated on next hook run)
- Cycle ends → all L3 exemptions invalidated in bulk
- If the same exemption is needed after expiry → new exemption in a new cycle (no automatic renewal)

## §7. Adoption Sequence

| Step | Task | Trigger |
|---|---|---|
| 1 | Add Scope (invariant/default) annotation to `06-rules.md` | Immediately |
| 2 | Create `~/.harness/user-rules.md` template | When first project starts |
| 3 | Scaffold `<project>/.harness/project-rules.md` | On first run of `cycle-init.py` |
| 4 | `cycles/<id>/exemptions.md` | Only when needed |

**L0 Core classification comes first**. Without this, all layers lose their meaning.

## §8. What Claude Does / What You Do

### Claude

- Detects rule conflicts → compares layers → decides automatically
- *Explicitly states* the layer of the applied rule: "Applying tab per L2 Project rule `R-PROJ-FMT01`"
- L0 Core override request → rejected with reason stated
- Conflict within the same layer → asks user to decide (no auto-interpretation)
- Style rules with only a `pointer:` field → reads the config file contents and applies

### You

- Author and maintain L1/L2 rules
- Register L3 exemptions together when writing the cycle-card
- Review repeated L3 exemptions for L2 promotion
- Agree on L0 Core classification *before the project starts*

## §9. Anti-patterns (New)

| Code | Name | Symptom |
|---|---|---|
| AP-26 | Layer auto-interpretation | Claude arbitrarily resolves same-layer conflicts |
| AP-27 | Invariant bypass attempt | Requesting L0 Core exemption via L3 |
| AP-28 | L3 without sunset | Registering a temporary exemption without an expiry date |
| AP-29 | Style markdown drift | Describing code style directly in rule markdown (not delegating to toolchain) |
| AP-30 | Promotion avoidance | Avoiding L2 promotion by repeatedly using L3 exemptions |

Each AP's *Symptom / Alarm / Response* needs to be added to `11-anti-patterns.md` under category **G. Rule Layering**.

## §10. Related Documents and Tools

- `06-rules.md` — L0 Core/Default rule body (Scope metadata enforcement required)
- `08-pass-criteria.md` — Gate score formula = L0 Core
- `09-pre-cycle.md` — L3 exemption registration procedure in cycle-card
- `11-anti-patterns.md` — AP-26~30 body (needs to be written)
- `scripts/rules-load.py` — needs to be extended to filter by Stage + Layer simultaneously
- `scripts/cycle-init.py` — needs to add `project-rules.md` + `exemptions.md` scaffolding
- `hooks/README.md` — needs to add `hook-formatter-config-exists`, `hook-l3-sunset-check`
