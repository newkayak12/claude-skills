# Dimensions to Count

| Dimension | Count |
|---|---|
| Naming | type/function/variable shapes, predicate prefixes, banned noise words, test naming |
| Functions | length distribution, parameter count, early return vs nested |
| Errors | exceptions vs result types, custom error hierarchy, swallowed catches |
| Comments | ratio, what they explain (why vs what), doc-comment coverage on public API |
| Structure | one type per file, package-by-feature vs by-layer |
| Dependencies | import direction between layers/modules, who may import framework code |
| Boundaries | generated dirs, append-only paths (migrations: never edited after add), co-change pairs (files that change together in ≥80% of commits) |
