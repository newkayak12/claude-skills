# Revise — step 4 in detail

## Claims first

`claims`: every page's figures and reason sentences against the items its `글감:` line cites (and
`선정.md`: a page citing a `제외` item is `excluded`). Each problem is an edit:

- `uncited`/`unknown_id` → cite the item;
- `unsupported` (`근거 없음`) and `not_in_material` → drop the figure or ask the user for its source;
- `to_confirm` → the user's words or `[확인 필요: …]`;
- `listed.self_confirmed` (the user's `본인 확인`: real work with no record) stays and is never cut as unsupported;
- `listed.tone` lines are reworded in the material's words;
- `unused_results` and `uncited_items` are offered to the user (a real result left out is a gap too), never added silently.

## Then the viewpoints, in order

Each its own numbered edit list with how to fix each:

1. recruiter 6초 and engineer 30초 (`feedback`, and `pattern` for how it reads);
2. interviewer attack (`mock-interview`'s questions on the page claims; a claim the user cannot defend
   goes to its item's `gaps.md`);
3. the user's own bar (noah, when connected: their stated standards, quoted).

Each viewpoint's findings go to a workspace file as `[{id,text}]`; run `manage.mjs settle --findings
<file>`, continue with `kept`, show the user `settled` (finding, line, share). No viewpoint proposes
cutting or merging pages without a ground, or cites market generalities ("면접 단골 질문"); the
first-page summary line need not carry a number (measured ones sit in evidence lines, small ones drop).

## Editing rules

- **Snapshot, then edit.** `snapshot --kind skeleton --level <major|minor|patch> --note "<what and why>"`
  (`--by 본인` only when the user decided it) before the first edit of a round (major = structure: page
  count, blocks, order; minor = content; patch = wording). Mark edited cells `[vX]`, unconfirmed wording
  `[vX 안]`. Lines are rewritten with `rewrite` where they need strength.
- **Decision gate.** Before carrying wording from an older version or backup, check it against
  `확정사실.md` (appendix-only, kept-apart blocks) and `선정.md` (`제외`); a hit is not carried. On every
  structure change re-check block separation (different work never shares a block, title or toc line).
- **Structure changes are asked.** Page count, block split, order: propose with the reason, wait for
  the user. Wording and defaults you may settle — and list them in the report.
- **Renumber.** An order change is one `renumber --map "<old>:<new>,…"`: it renumbers headings and
  references, moves the page sections into the new order and verifies; it writes only when the result
  verifies, leaves fenced code alone and refuses a target page the map leaves in place (never by hand or
  in two passes). Report changes, warnings and problems. By hand, and listed in the report: numbers
  without `쪽` outside a `쪽` column, a block order mark `(n/N)` the warnings name, and everything in
  portfolio-deck.mdx (`by_hand`: slide order, `<!-- N. -->` comments, toc page cells). Two pages sharing
  one description move apart badly: give each page its own first.
- **Align table.** Keep the table at the end of portfolio-skeleton: 번호 · 대상 · 맞출 것 · 상태
  (`본인 확인 대기` / `portfolio-deck.mdx 반영 때` / `그림 작업 때` / `캡처 대기`); slots at their budget go
  in as `check` items.
