# Answerability Contract

Use this contract for every non-trivial vault. A vault is non-trivial when it emits
`_knowledge/catalog.jsonl`, spans multiple source areas, or is intended for repeated
operational lookup.

Structural validity and answerability are separate gates. A clean catalog, resolved links,
and complete metadata do not prove that the vault can answer its motivating questions.

## Atomic Claims and Relation Notes

The atomic unit is the claim, not the entity. A note may cover multiple entities when its
durable claim is the relation between them.

Use these first-class relation types when they affect lookup or explanation:

| `relation_type` | Meaning |
|---|---|
| `contrast` | Explains material similarities and differences across two or more participants |
| `equivalence` | Establishes that names, records, or behaviors refer to the same thing under stated conditions |
| `sequence` | Establishes an evidence-backed order among events, states, or processing stages |

A relation note must include:

- `type: relation` and one allowed `relation_type`;
- at least two stable participant note IDs;
- evidence for every participant, not one shared source attached to the note as a whole;
- the dimensions, conditions, or ordering rule that make the relation meaningful;
- uncertainty where any side is inferred or missing.

Represent the same contract in the catalog so it can be checked without parsing prose:

```json
{
  "id": "stock-table-contrast",
  "path": "notes/stock/stock-table-contrast.md",
  "title": "재고 수불부, 현황표, 변동표 대조",
  "type": "relation",
  "relation_type": "contrast",
  "participants": ["stock-ledger", "stock-status", "stock-change"],
  "evidence_by_participant": {
    "stock-ledger": ["src/mapper.xml#getStockGoodsListVer2"],
    "stock-status": ["src/mapper.xml#selectStockStatusDataTables"],
    "stock-change": ["src/mapper.xml#getStockChangeGridVer2"]
  }
}
```

## Vocabulary Bridges

Keep alternate names for the same referent in `aliases`. Do not call a UI label, mapper ID,
and database column aliases of one another merely because they participate in one workflow.

Use separate retrieval fields:

- `user_terms`: operator language, UI labels, tab names, and common spoken terms;
- `source_symbols`: code symbols, statement IDs, configuration keys, and schema identifiers;
- `lookup_layers`: the layers intentionally bridged by this record, using controlled values
  such as `operator`, `ui`, `code`, and `database`.

Keep `aliases`, `user_terms`, and `source_symbols` pairwise disjoint within a record. Put a term
in the field matching its actual semantics instead of duplicating it to satisfy bridge coverage.

When `lookup_layers` bridges a user-facing layer (`operator` or `ui`) to an implementation
layer (`code` or `database`), both `user_terms` and `source_symbols` are required. Do not force
this rule on internal-only code notes or user-only policy notes that have no cross-layer lookup
job.

### Repairing Bridges After a Failed Lookup

A missed competency question is the normal reason to add vocabulary, and also the normal way a
vault starts scoring itself. Two rules keep the repair honest:

- **Ground every added term in the source material, never in the question.** Copying a phrase
  out of `_knowledge/questions.jsonl` into `user_terms` guarantees that question retrieves the
  note and measures nothing. Add `결제 승인 화면` because that label exists in the UI, the code,
  or the operator's own words — then cite where it came from. If a term cannot be found outside
  the question set, it is not vocabulary; the gap is a missing note or a missing source.
- **Repair the field, not the score.** A term whose semantics do not match `user_terms`,
  `source_symbols`, or `aliases` does not belong in whichever field happens to lift the rank.
  Notes written in a frontmatter style that has no bridge fields at all need the fields created,
  not the term forced into `tags`.

Run the retrieval-repair loop in `knowledge:sqlite-index-builder` when repeated lookups fail;
it measures whether an added term actually helped rather than assuming it did.

## Competency Questions

Store the canonical, machine-checkable question set in `_knowledge/questions.jsonl`. Use one
record per question:

```json
{"id":"stock-table-differences","question":"재고 수불부 / 현황표 / 변동표 차이가 뭔가?","lookup_job":"compare operator-facing stock reports","kind":"comparison","required_note_ids":["stock-table-contrast"],"required_user_terms":["재고 수불부","재고 현황표","재고 변동표"],"required_source_symbols":["getStockGoodsListVer2","selectStockStatusDataTables","getStockChangeGridVer2"],"graph_check":true,"required_graph_node_ids":["stock-ledger","stock-status","stock-change"]}
```

Choose questions from actual lookup jobs. For each important lookup job include the applicable
shapes: direct lookup, synonym or operator-language lookup, comparison, cross-layer lookup,
multi-source synthesis, and freshness-sensitive lookup. Do not satisfy the gate with a fixed
number of easy questions.

After running each question through `knowledge:knowledge-query`, write one record to
`_knowledge/question-results.jsonl`:

```json
{"question_id":"stock-table-differences","coverage":"complete","answer_note_ids":["stock-table-contrast"],"answer_note_hashes":{"stock-table-contrast":"<sha256-of-note-body>"},"evidence_refs":["src/mapper.xml#getStockGoodsListVer2","src/mapper.xml#selectStockStatusDataTables","src/mapper.xml#getStockChangeGridVer2"],"missing":[],"evaluated_at":"2026-08-28T00:00:00Z"}
```

Coverage meanings are strict:

| Coverage | Meaning | Build gate |
|---|---|---|
| `complete` | Every material part is supported by the required notes and direct evidence | Pass |
| `partial` | Some parts are missing, conflicting, stale, or require material inference | Fail |
| `unanswerable` | The vault cannot establish the answer | Fail |

An expected note path alone is not proof. A `complete` result needs non-empty evidence registered
by the required notes, contains all `required_note_ids`, records the SHA-256 body hash of every
answer note listed by the result, and has no missing items. A later note edit makes the old result
stale and requires re-evaluation. A failed question becomes a concrete extraction or correction task;
preserve it rather than replacing it with an easier question.

Summarize the results numerically in `_knowledge/coverage.md`, including total, complete,
partial, unanswerable, and the resulting percentage. Include this canonical line so the validator
can detect a stale human-readable report:

```text
Answerability: 3/3 complete; 0 partial; 0 unanswerable; 100%
```

### What Belongs in `required_note_ids`

A note is required when the answer must use **its** evidence. A note that is merely about the
same subject — the status-code table behind a workflow question, the MOC that lists both sides
of a comparison — is background, and requiring it turns the gate into a reading-list check that
a correct answer fails. When a contrast note already carries evidence for every participant,
the contrast note is the requirement; do not also require each participant note unless the
question asks for something only the participant note establishes.

The reverse error is worse: shrinking the list until every answer passes. Required notes come
from the lookup job, and a question whose evidence genuinely spans four notes keeps all four.

### Citation Precision

Answerability counts only whether required notes were cited. That number rises for free whenever
a change makes answers cite more notes, so record precision beside it:

- **recall** = cited ∩ required / required — did the answer use the evidence it needed;
- **precision** = cited ∩ required / cited — how much of what it cited was the evidence it needed;
- **off-key** = cited notes outside `required_note_ids`;
- **full** = questions where every required note was cited.

```text
Citations: recall 3/3; precision 3/4; off-key 1; full 1/1
```

The validator scores every result, including `partial` and `unanswerable` ones, so a failed
answer still reports how close it came. It **reports** these numbers and checks the line above
only when present; off-key citations are usually legitimate supporting context, and gating on
precision would teach answers to cite less rather than better. Read the pair together: a change
that lifts recall while precision falls is buying coverage with noise.

## Graph Question Reachability

When graph artifacts exist, mark relationship-heavy questions with `graph_check: true` and
emit `_graph/question-reachability.jsonl` records:

```json
{"question_id":"stock-table-differences","reachable":true,"answer_node_ids":["stock-ledger","stock-status","stock-change"],"max_hops":2,"paths":[{"node_ids":["stock-table-contrast","stock-ledger"],"edge_ids":["contrast-ledger"]}],"evidence_refs":["src/mapper.xml#getStockGoodsListVer2"],"checked_at":"2026-08-28T00:00:00Z"}
```

A reachable path uses declared, directional relationship types whose edges have `source_refs`;
an optional `evidence` excerpt explains the edge but does not replace provenance.
Shared source anchors, co-occurrence, generic hubs, or `RELATED_TO` edges are candidate signals,
not sufficient path evidence. Check inverse edges only when the ontology declares a relation
symmetric or defines a materialized inverse; directional edges are not defects merely because
their reverse record is absent.

## Human Review

Evidence strength and review workflow are separate. Keep `confidence` for source strength. When
present, `review_status` uses `source-checked`, `needs-human-review`, or `human-confirmed`.
Use `human-confirmed` only with `reviewed_by`, an ISO-compatible `reviewed_at`, and
`review_evidence`. Every `needs-human-review` note ID must appear in
`_knowledge/needs-human-review.md`; do not silently promote code agreement to business truth.

## Completion Gate

Run the bundled validator before declaring a non-trivial build complete:

```sh
node knowledge/scripts/validate-knowledge.mjs --root <vault> --require-answerability
```

For an installed plugin, resolve the same script from the plugin root. The gate fails on missing
question artifacts, partial or unanswerable results, missing relation-side evidence, incomplete
cross-layer vocabulary bridges, invalid human-confirmed records, or invalid graph reachability.

The validator checks the artifact contract; it does not prove that source claims are true. The
builder must still inspect the cited anchors and compare every side of synthesized relation
claims before assigning `complete` coverage.
