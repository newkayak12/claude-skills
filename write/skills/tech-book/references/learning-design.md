# Learning design — turn chapters into a book

Use this reference in stages 0–6. It defines the educational spine that connects the TOC, examples, practice, and
reader testing. Adapt the number and size of activities to the audience; preserve the progression and evidence.

## Book arc

`brief.md` names four things before the TOC is written:

- **starting performance:** what the reader can already do without this book;
- **terminal performance:** one realistic task the reader should complete unaided after the book;
- **throughline:** one question or tension that makes every part necessary;
- **capstone:** an artifact or decision that demonstrates the terminal performance, with observable success criteria.

Divide the book into parts only when each part crosses a distinct threshold in that performance. For each part, state
the new class of problem the reader can solve. Revisit important ideas with increased demands: first recognize, then
explain, apply, diagnose, and finally design or judge. A later chapter must use earlier knowledge rather than merely
mention it.

## Chapter learning contract

Every TOC chapter block records:

- `entry:` the exact knowledge and capability assumed from earlier chapters;
- `exit:` one observable performance newly possible after this chapter;
- `misconception:` the plausible prior model or shortcut that fails here;
- `example-step:` what changes in the running example and why this chapter is needed;
- `evidence:` what the reader produces or decides to prove the exit performance.

Keep learning goals to 3–5 and write them as observable actions. “Understand” and “learn” are not evidence. Prefer
“explain why,” “predict,” “diagnose,” “choose and justify,” or “implement and verify.” Each goal must be taught in a
section, exercised, and checked in the chapter summary.

## Explanatory sequence

Use this sequence for a chapter unless the subject gives a concrete reason to reorder it:

1. **Problem:** a concrete situation the reader cannot yet handle; show the cost of guessing.
2. **Prior model and failure:** let the reader predict with their current model, then show the observation it cannot
   explain. Do not invent a straw misconception.
3. **Working model:** explain the smallest mechanism that accounts for the observation. Separate causal mechanism,
   rule of thumb, and implementation detail.
4. **Guided example:** change one meaningful variable at a time and narrate the decision, expected result, observed
   result, and interpretation. Keep incidental setup out of the teaching path.
5. **Boundary and counterexample:** show where the model, analogy, or rule stops working and what replaces it.
6. **Independent transfer:** give a different case with no copied solution path. The reader must choose an approach,
   predict or produce a result, and verify it.
7. **Retrieval and connection:** close without rereading prompts: explain the mechanism, diagnose the failure, and
   connect the chapter's exit performance to the next threshold.

## Examples and practice

Use one running example when the subject supports cumulative change. Keep an `example-ledger.md` with one row per
chapter: starting state, change, concept exposed, observable result, artifact path, and canonical names (tables,
indexes, accounts, files later chapters reuse). A chapter may use a local example when forcing it into the running
example would add irrelevant machinery; record why in the ledger.

A running-example chapter whose blocks build runnable state (files, a database) ends with `### 장 끝 상태` (what
exists, by canonical name) and ships
`artifacts/chNN/rebuild-end-state.sh` — one command, any working directory, builds that state from nothing — plus
`checksums.txt` over files the chapter's blocks produce, never files the reader writes or output that varies run to run (timings, ids, dates). Whoever writes the script runs it
twice from an empty directory and checks both runs; `checksums.txt` is copied into the rebuilt state. Once `final/N-1.md` exists it
wins over the ledger; a mismatch is a `cross-chapter:` item that corrects the ledger. N's stopping round waits for `final/N-1.md`;
a zero round pinned to a draft of N-1 is followed by one round on `final/N-1.md` that re-runs only the checks the
upstream diff touches.

Every non-trivial chapter includes a worked example with reasoning and verification, the six teaching elements of
`teaching-elements.md` (prediction, reproduced failure, diagnosis without answer, transfer with traps, observed edge
case, equivalence check), and a compact answer key containing the decision rule and evidence, not just the answer.

Practice should test the chapter's exit performance. Avoid questions answerable by copying the preceding paragraph.
For code or commands, specify starting files/state, constraints, expected observable behavior, and a verification
command or inspection. For conceptual subjects, require a prediction, comparison, diagnosis, or justified choice.

## Review evidence

Each learning goal names the level it claims; review tests it at that level:

| level | reader evidence |
|---|---|
| recall | retrieve the key term or condition without cues |
| explain | describe the mechanism and its boundary in their own words |
| apply | use it in a changed but recognizable case |
| diagnose | identify the cause of a failure from evidence |
| design/judge | choose among approaches and justify tradeoffs |

A fluent summary is not proof of application. The reader test supplies only information available by that point in
the book and checks the exercise's expected evidence; a goal is evidenced only when a blind reader passed it as
written, at its claimed level. Flag an objective as unsupported when the chapter does not teach, exercise, and test
it. Book-wide review checks prerequisite violations, unexplained difficulty jumps, running-example continuity (every
`rebuild-end-state.sh` replayed in order), duplicated explanations, and whether the capstone can be completed using
only the book.
