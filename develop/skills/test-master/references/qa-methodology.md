# QA Practice

Planning, design technique, defect handling and quality signals, for work beyond writing automated checks.

## Test plan, short form

- Objective and release it supports
- In scope / out of scope
- Risks ranked (likelihood x impact) and how each is tested
- Levels and who owns them
- Environments and data
- Entry criteria (build deployed, smoke green) and exit criteria (no open Critical/High, agreed coverage, performance target met)
- Schedule, people, reporting cadence

Spend test effort in proportion to risk: money movement, personal data and frequently changed modules first.

## Design techniques

| Technique | Use when | Method |
|---|---|---|
| Equivalence classes | many inputs, same treatment | one representative per class, valid and invalid |
| Boundary values | ranges and limits | at, just inside, just outside each edge |
| Decision table | several conditions combine into rules | one case per distinct rule column |
| State transition | lifecycle objects (order, subscription) | cover each legal transition and attempt illegal ones |
| Pairwise | many parameters with few interactions | generate a set where every pair of values appears at least once |
| Exploratory | new or unclear areas | timed session with a charter ("explore refunds with partial shipments"), notes on what was tried and found |

Exploratory sessions of 60-90 minutes with a written charter and debrief find what scripted cases do not.

## Non-functional checks

- **Usability**: can a new user finish the main task unaided; where do they hesitate.
- **Accessibility**: keyboard-only operation, visible focus, text alternatives, sufficient contrast, labelled form fields, screen-reader pass on key flows (target WCAG 2.1 AA).
- **Localization**: long strings, non-Latin scripts, date/number/currency formats, right-to-left layout, time zones.
- **Compatibility**: pick browsers/devices from your own traffic data; test the top by share, spot-check the rest.

## Defects

Report so that someone else can reproduce: title naming the symptom, environment/build, numbered steps, expected vs actual, evidence, severity and priority (impact vs urgency are separate). One defect per report.

For recurring defect types, ask "why" repeatedly until you reach a process cause (no test at that boundary, unclear requirement), and fix that too.

## Signals worth tracking

| Signal | Reading |
|---|---|
| Defect escape rate (found in production / all found) | quality of earlier testing |
| Time to detect and to fix | feedback speed |
| Flaky-test rate | trust in automation |
| Change failure rate | how often releases cause incidents |
| Coverage on changed code | whether new work is tested |

Treat a metric as a question to investigate, not a target to maximize.

## Shift left

Involve testers when requirements are written: challenge ambiguous acceptance criteria, agree examples before coding, review designs for testability. Aim for fast feedback tiers: seconds (unit, local), minutes (integration on pull request), hourly or nightly (E2E, performance).

## Quality gates

A gate is a checked condition before promotion: build and tests green, no new Critical/High findings, coverage on changed lines not reduced, migrations verified, rollback known. Keep gates few, automatic and enforced; a gate people routinely bypass is noise.
