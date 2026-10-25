# Principles — composition, writing, never

General rules only. A candidate's own decisions (which project is appendix-only, which names may
appear) live in that workspace's `docs/확정사실.md`, not here.

## Composition

| Rule | What it means |
|---|---|
| Section pages | A divider page works only when at least four body pages follow it. Appendix: one appendix toc page, then attachments only |
| Body vs appendix | Body holds projects told as problem → solution. Everything else is a document capture in the appendix. After moving a project to appendix-only, check no other page still carries it |
| Order | Finished projects and the strongest signal first; inside a block the strongest page first. Real chronology may yield |
| Block separation | Different work never shares a block, title or toc line (e.g. a partner project and an operations incident). A page where both truly overlap sits with its own work; the other side points to it by page number |
| Merged pages | Pages merged to hit a count are split back once the reason is gone; body text is not cut to fit |
| Strengths | Cover, profile and core-strength page carry the same sentences in the same order. Cover: sentence + one evidence phrase; core page: sentence + two evidence bullets with page numbers |
| Strength evidence | Pick the evidence first, then fit the sentence. A sentence true of one case only is too narrow; a strength backed only by a side project is weak |
| Archetypes | Use each template archetype for its own purpose; another use needs a written reason and is reverted when the reason goes |

## Writing

- **Write the role.** No label like "공동 대응" — incidents are always handled by several people.
  Others' actions: no subject, order and reason. The candidate's: by role (wrote the report as
  owner, led the review, shipped the recurrence fix).
- **Why first.** A project's first page shows the whole project and opens with the structural
  reason, not the measurement or a rebuttal of someone.
- **No small-scale numbers.** "Thousands per minute" reads as "should have held anyway". Give the
  reason in structure; numbers are for spoken answers.
- **Do not invent purpose or causality.** Use the purpose the candidate stated. Check causality by
  dates: a design decision dated before the measurement cannot be "chosen from the measurement".
- **History without count or date becomes judgement.** Not "it had outages" but the candidate's
  judgement from what they measured and the counterpart's policy.
- **In progress is not done.** Result words ("without downtime") only after the result exists.
- **No market claims** ("a classic interview question").
- **Names.** A partner's real name only with a public source and the candidate's consent; other
  vendors are "상대 시스템". Never internal identifiers (ticket keys, colleagues' names, network ids).
- **No live security weakness of the current employer** ("the DB is open to the outside"); phrase
  it as structure, and an unstarted fix only as a goal.
- **Drop tacked-on counts** (N on-call reports, N runbooks).

## Never

| Mistake | Instead |
|---|---|
| "Let's merge these two pages" with no reason | Give the reason to cut first; no reason, no proposal |
| Carrying an appendix-only project back as `[유지]` from an older version | Check carried wording against `확정사실.md` (Process 4) |
| Putting different work in one block again | Re-check block separation on every structure change |
| A plausible purpose or causality | The candidate's words and dates; otherwise `[확인 필요]` |
| Renumbering pages by hand or in two passes | `snapshot` first, then one `renumber` pass and `verify` |
| Reading a vague answer broadly | Do the shared part, hold the rest, say so |
| Exaggeration | No market claims |
| Bringing back a placement the user already settled, again and again | One case once; a settled placement moves only when the user says |
| Keeping two pages merged after the reason to merge is gone | Undo the merge when its reason disappears |
| Filling a field that reads as empty talk (team of one, 100% share on solo work) | Change the label so the field means something |
| Leaving picture slots empty so the template's picture repeats across pages | A new picture where the content differs |
| Page references at the end of body sentences (`(16쪽)`) | No page numbers inside sentences; they read machine-made |
| Reusing an older version's figure as is | Check the words inside it against the current text; redraw when they differ |
| Taking a summary document's count as the fact | Check it against the raw record; held items are not counted |
| Bold across a whole line or report | Template run formats (`[text]{n}`) in the deck; plain headings in reports |
| Fixing a render problem on the spot | Note it in `다음렌더-지침.md`; fix at once only what the user said to fix |
| Treating a question as an instruction ("질문! 바꾸란건 아님") | Answer with a judgment; change nothing |
| Asking what the analysis folder already holds | Search first; ask only what only the user knows |

Shell: in zsh an argument starting with `=` (`echo ====`) errors — use `---` or `[label]` separators.
