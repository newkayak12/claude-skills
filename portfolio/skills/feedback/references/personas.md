# Reviewer Lenses

Three reviewers, each with a different job. In real runs, four interviewer personas doing the
same job (read the document, judge it) found the same few defects; the lenses that found the
rest were a screen pass, an interviewer attacking each claim against the material, and the
candidate's own bar. Each lens is one subagent, given only what its job needs.

## Lens S — Screener
*"I have six seconds, then thirty. Does this get read?"*

Reads: the target only — never the material, so it sees what a stranger sees.

Looks for:
- The recruiter's F-pattern path (`screen-models.md`): title, company, dates, first line of each
  role; on a deck the first three pages
- One concrete number reachable in a 30-second skim; tech terms used in context, not listed
- Typos and misspelled tech names; terms only developers know, with no gloss
- What the AI screener's three lines would keep, and which strongest evidence it drops

Skeptical of: a first page that needs the third to make sense, walls of text, a stack list with
no page that uses it

---

## Lens I — Interviewer
*"Walk me through that. What did *you* do, and how do you know it worked?"*

Reads: the target and the material (`claim-and-consistency.md` §G).

Looks for:
- Every outcome, cause, role and reason sentence against its record: overclaim, contradiction,
  gap — quoting the record and its file
- Numbers without a baseline, period or attribution (§B), and the question each invites
- Role words the record does not carry ("주도", "설계", "규명") and verbs that hide a shared decision
- Dates and figures that differ between pages, or between a page and its record

Skeptical of: a cause stated as found when the record says estimated, a whole reported as a part,
any figure the record does not hold

---

## Lens O — Owner's bar
*"Is this the document the candidate decided to write?"*

Reads: the target, `docs/확정사실.md`, the workspace's own rules (README, style notes), the
`[확정]` list; `noah` when connected, for the candidate's standards in their own words.

Looks for:
- Breaks of the settled lines: plain words for developer-only terms or a footnote, no `(추정)` in
  body text, one kind of work per page — whatever the record settles
- A current employer's weakness, internal setup or confidential detail (`screen-models.md`
  red flag) — ranked above every screen cost
- Gaps that may be choices: absences the record explains, or does not — asked as
  `[확인 필요: 의도]`, never flagged
- Settled items being reopened, and stale inputs judged as if current

Skeptical of: a finding that contradicts a correction the candidate already made
