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
| Block ends with a result | Every body project block closes on its result-and-lessons page (or a result archetype), so the reader never leaves a project without its outcome. A block without one carries a written reason, and the reason is asked |
| One picture, one-picture page | A page with one picture uses an archetype built for one, or the picture fills its panel (`panel_margin:`); never a two-picture archetype with half the page empty. Pictures on one page share one text size: draw them at the same scale |
| Figure text | Text inside a figure reads at 8pt or more where it is placed; `check` warns below that. Enlarge the picture, cut the figure's words, or redraw it — a figure nobody can read is decoration |

## Chapters

Before the 선정 rows, decide the chapters: which project becomes how many chapters, each ending on
one result (the user's deck split one OMS project into a rate-limit chapter and an incident chapter).

- **The result is the chapter's, not each item's.** An item that is a step toward its chapter's
  result is 본문 even with nothing measured after it: the 30-day baseline the migration's comparison
  rests on, the two defects caught before the switch, the version constraint that chose the
  rate-limit algorithm. Three runs sent all three to 부록 for "no result after", and the user's deck
  has them in the body (2026-11-25). A chapter whose result is a stated outcome without a number
  ("running now, sufficient on current traffic") is still a chapter; the number is a question.
- **A scene that ends where it starts goes to 부록 as a document:** a flaw written down with no
  fix and no result after it (not a textbook Outbox), a metric found blind with nothing measured
  after (a dashboard), a plan changed that no page tells (Kafka → SQS). In the body the reader asks
  "why not done properly?" and the page has no answer (user, 2026-11-24: "이런 판단이 아쉬운거임").
  It never borrows another item's result to become its own chapter.
- **Writing a chapter (step 3):** one cover, one problem-and-solution page per 본문 item that leads
  a turn of the story (at most three), one results page — the user's migration chapter is five pages;
  three runs of one skill wrote 5, 5 and 8. Supporting B items are cited on those pages, never given
  their own. Every 본문 item `선정.md` gives the chapter is cited on one of its pages (a run dropped the
  two pre-switch defects). Where `확정사실.md` and a 선정.md line differ, 확정사실 wins. Third-round
  review findings are not edited: two runs edited after the third round and nothing reviewed it.
- **A 확정사실 ban on wording bans the sentence, not the item** ("재발 방지가 장애를 키웠다" is
  banned; the 4 recurrence fixes still lead the incident chapter).

## Resume

A resume cites a subset of the deck's 본문, never an item the deck left out. Per chapter keep the
items that carry its result line and the one decision a reader asks about first; drop the ones
that only lead into another (the user's resume cut from the deck: the not-textbook Outbox, the
dashboard, the two defects before the switch, the PMS and B2B appendices). Add the 부록 items that
are tools others used — a shared library several services run — under the role or skills section,
not as a project (the user's resume cites the scheduler library, which the deck keeps in an
attachment). The user's 2026-11-13 resume: migration (baseline, plan changed, silent check),
incident (owner, 4 fixes), rate-limit, all five side-project items, plus the library.

## Writing

- **Plain words.** A word only a developer knows is said in plain words; if it must stay, a footnote
  explains it. Spell a term out at its first use on each page. Speaker notes are exempt.
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
| Fixing a render problem on the spot | Note it in `template/next-render.md`; fix at once only what the user said to fix |
| Text, caption or photo crossing the safe area or touching another box | Shorten or move the content; the template's margins and gaps hold (portfolio and resume alike) |
| Fitting a page by shrinking type or line spacing | Cut text by the reported overflow (`over_lines`); type and spacing stay the template's |
| A resume re-styled by hand (a copied template with styles added, a post-build script) | Map roles to the user's own template with `samples:`; the engine copies the look |
| A resume that ignores the template (no photo, other fonts, other order) | The template's section order, look and photo; the portfolio's project order |
| Treating a question as an instruction ("질문! 바꾸란건 아님") | Answer with a judgment; change nothing |
| Asking what the analysis folder already holds | Search first; ask only what only the user knows |

Shell: in zsh an argument starting with `=` (`echo ====`) errors — use `---` or `[label]` separators.
