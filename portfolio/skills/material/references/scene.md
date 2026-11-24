# 장면 — what counts, fixed by example

Writer and verifier use this page word for word. Each verdict names the row it matched.
The examples are the user's own picks (their 선정.md, 2026-10-30) and the cases three runs of one
skill judged differently (2026-11-24: 2, 8 and 11 failures on the same 27 items).

## Pass — the person's judgment shows in one of these

| # | Kind | Example (item → the scene) |
|---|---|---|
| P1 | Their own plan changed in review, and why | 01/A3: their staged-migration plan was held in review and became Feature Flag + Shadow |
| P2 | A flaw of their own, written down | 05/A2: the semaphore sat inside the lock, so it did not limit concurrency |
| P3 | A limit measured before redesigning | 05/A1: the lock structure's serial ceiling measured first |
| P4 | The condition under which their fix stops working | 05/A5: when the redesign loses — **stays a pass with the numbers held back** (`안 씀`); the condition in words is the scene |
| P5 | A check they found could be silently wrong | 01/A4: INSERT IGNORE turns "Data too long" into a warning |
| P6 | A measured result that proves their decision | 05/A4: they moved where users wait; p95 21.5s → 1.7s is the scene, the decision plus its measured effect |
| P7 | Their role and reasoning in an incident or review | 03/A1: as the incident owner they narrowed the cause to two layers |
| P8 | The problem itself restated by them | 05/A3: their 2026-11-07 correction — the point was moving the serialization point, not the rejection message |

## Weak pass — keep the item A, write `(weak)` after the scene

- A team decision where the line states the person's own part in it.
- The quote is the curator's narration, but it points to a document the person wrote.

## Fail — fix the scene, never drop the item for it

| # | Why | What to do |
|---|---|---|
| F1 | It says what the system does, no decision | find their decision in the item; if none, propose regrade to B |
| F2 | Work volume or a task line (a 91-API survey) | propose regrade to B |
| F3 | The source is someone else's (`_참고_타인작성`) and nothing says they wrote it | a `gaps.md` question asking who wrote it; keep A |
| F4 | A later 정정 rejects the title or premise | **not a failure**: write the scene from the latest 정정 block (P8); the stale title is a `gaps.md` question |

A number 확정사실 bans never fails a scene: the scene is written without it (P4).
