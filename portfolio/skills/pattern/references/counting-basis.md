# Counting basis — two-version mode (basis_version 1)

The key set and each key's count are fixed here and in `scripts/pattern-score.mjs` (`KEYS`, `BASIS`);
they change together and `BASIS_VERSION` moves. Rounds compare only scores of the same basis_version.

Scope: the page body of a skeleton (`## N쪽` / `## N`) or deck.mdx (`## @sN`, slot values). Out of
scope, never counted: `notes:`, `각주:`, `주:`, `footnote:`, `[^n]:` lines and their indented
continuation, headings, `>` history lines, tables, `글감:`/`근거:`, picture paths, `!drop`, and
everything before the first page heading. A sentence is a body piece cut at `. ! ?` and newlines,
at least 4 non-space characters.

Every score is a share, 0-100 rounded, **higher reads better** (so manage's `compare`, where a drop
is worse, is right). A zero denominator scores 0. Raw tallies come beside the scores as `counts`.

| key | counted as |
|---|---|
| `decision_verb_pct` | sentences with 제안 · 채택 · 배제 · 결정했 · 판단했 · 선택했 · 도입하기로, of all sentences |
| `active_pct` | 100 − share of sentences with 되었 · 되어 · 됐 |
| `own_subject_pct` | 100 − share of sentences with 저희 팀 · 우리 팀 · 팀에서 · 팀이 |
| `specific_pct` | 100 − share of sentences with 관여 · 참여 · 기여 |
| `number_density_pct` | impact claims (개선 · 감소 · 향상 · 단축 · 증가 · 절감 · 안정 · 처리 · 성능 · 확대 · 줄였 · 높였) that contain a digit, of all impact claims |
| `failure_pct` | sentences with 실패 · 장애 · 오류 · 롤백 · 잘못 · 한계 · 아쉬 · 부족 · 되돌, of all sentences |
| `decision_marks_pct` | sentences with 대신 · 대안 · 비교 · 트레이드오프 · 이유는 · 선택한 이유, of all sentences |

The script's output is a count, not a verdict. The SKILL's boundary rule applies before any flag, and
`저는/제가` is still not measured.

Shape for manage: `--out <dir>` writes `pattern-a.json` and `pattern-b.json`, each flat
`{ "<key>": <number> }` — what `manage.mjs compare --before/--after` reads — and `pattern-basis.json`,
this basis. manage saves the pair beside the round's other scores
(`snapshot/scores/skeleton-vX.Y.Z.json`; the basis file next to them).
