# PR Descriptions — what a person writes

Used by the humanizer pass for `pr` / `commit` genre and by draft mode when the input is a diff.

## Shape

A reviewer reads a PR description to decide **how to review**, not to learn what changed — the
diff already shows that. Four things, in this order, sized to the diff:

1. **Why** — the problem or pressure that made this change necessary, in one or two sentences.
   Include the number, error, or ticket that proves it exists. If the author had to choose
   between approaches, say which and why the other lost.
2. **What** — the change at the level of behavior, not files. "Retries now back off
   exponentially and give up after 5" — not "modified RetryPolicy.kt, added BackoffConfig".
3. **How to review** — where to look first, what's mechanical and can be skimmed, what the
   author is unsure about. This is the sentence only a human writes.
4. **Risk / rollback** — what breaks if this is wrong, whether it's flag-gated, how to undo.
   Omit for trivially reversible changes; say "reversible, no migration" if that's the fact.

Length: a one-line fix gets one or two sentences, no headers. A multi-file feature gets four
short paragraphs. Headers only when the body exceeds a screen; even then, prefer bold-free prose.

Shape, measured against real reviewers: the first sentence carries the why, inside 30 words —
"`Blueprint.add_url_rule` fails `mypy --strict` because `setupmethod` erased the decorated
function's type." No paragraph past ~80 words; when the why has three or more concrete causes or
the change touches three or more separable places, a flat list — one line per item, each mapping
to something the reviewer can find in the diff — reads faster than the same content as prose. The
"how to review" sentence and the author's doubt get their own short paragraph near the end, not a
clause inside a long one. Prose walls lose to bullets; bullets lose to prose when the items are
really one thought — that is the whole rule.

## Tells specific to PRs

| Tell | Person's version |
|---|---|
| "This PR introduces / implements / adds…" | Start with the reason: "Checkout timed out for ~3% of orders because…" |
| File-by-file list | Cut; the diff tab exists |
| "Improved performance / readability / maintainability" | The measurement or the concrete thing that got easier |
| "### Changes / ### Testing / ### Notes" for a 40-line diff | Three sentences |
| "Tested locally and all tests pass" | Which test proves the fix, or that a new one was added |
| No doubt anywhere | "Not sure the 5-attempt cap is right — open to lowering it" |
| Title is the branch name or a summary of the diff | Title is the outcome: "Stop double-charging on retry" |

## Reading a diff to draft one

When the input is a diff or branch and no description exists yet:

- Read commit messages, linked issue, and the diff. Derive **why** from those; if it isn't
  recoverable, ask the author one question — "what was breaking?" — before drafting.
- Every "before X, now Y" claim needs a `-` line that shows X. A parameter that used to ride
  through `**options` was not "silently dropped" — it was untyped; say that. When the diff shows
  a change but not a bug, the honest claim is the smaller one ("now explicit", "now typed"), and
  the why is the ticket or the symptom the material names — never a failure you inferred. A
  reason the material doesn't contain is a question for the author, not a sentence in the draft.
- Find the one hunk a reviewer must read carefully and name it in "how to review".
- Look for migrations, config, feature flags, deleted tests — those decide the risk line.
- Write it as the author talking to a teammate in the review thread, in the author's language.
