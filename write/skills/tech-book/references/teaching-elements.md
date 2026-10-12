# Teaching elements — required per chapter

Every non-trivial chapter carries all six, each once by default (a second instance only when a learning goal needs
it, said in the answer key), all on the chapter's one running example except the transfer task. A chapter where one cannot apply (a purely conceptual chapter with no
runnable failure, say) writes `해당 없음: <element> — <reason>` in its answer-key section; the reader check judges
the reason. Each element is checked by the reader check (house-style "Review file"): missing → 🔴; present but its
answer is readable from the task text → 🟡.

| # | element | what makes it count | does not count |
|---|---|---|---|
| E1 | prediction before run | the reader writes a predicted result (rows, value, error) before the block that shows it | "다음을 실행해 봅시다" with the result directly below |
| E2 | reproduced failure | the wrong version is run and its real error or wrong output is printed, then explained by mechanism | describing an error in prose without running it |
| E3 | diagnosis without answer | a broken artifact plus its observed output; the reader finds the cause from evidence; the answer is only in the answer key | a checklist of "things to check" |
| E4 | transfer with traps | different surface (other entity, period, policy) and ≥ 2 traps a copied solution would fall into, each named in the answer key | same task with renamed tables; a task sentence that names the method to use |
| E5 | edge case made and observed | the reader creates the boundary state (tie, NULL, empty, limit) and observes the rule's behaviour on it, then restores state | an edge case only mentioned |
| E6 | equivalence check | the same result built two structurally different ways, compared mechanically (`diff`, counts, totals) | the same solution with names changed |

## Subjects without runnable code

The six are about reasoning, not execution. Where the chapter's subject is not code (requirements, process,
architecture judgment), each takes its non-code form; never turn the chapter into a coding chapter to satisfy them.

| # | non-code form |
|---|---|
| E1 | the reader commits to a judgment (which option, what will happen) before the case outcome is shown |
| E2 | a plausible approach played out on a concrete case until its consequence is visible (rework, conflict, outage) |
| E3 | a flawed artifact (a ticket, spec, ADR, review thread, incident log) with its observed consequence; find the causes |
| E4 | the same judgment in a different domain, with ≥ 2 traps a copied answer falls into |
| E5 | the boundary case of the rule (when the principle stops paying off), stated with its consequence |
| E6 | two framings of the same decision checked against the same explicit criteria and shown to agree or not |

Code the book does run uses the brief's stack; when it cannot run here, mark the block `[확인 필요: 실행]` — do not
switch language.

## Shape, not content

These exemplars come from a MySQL chapter on aggregation. Copy the shape; never the subject, names, or numbers.

**E3 — diagnosis without answer**

```
### 진단 과제: <symptom in the reader's words>
<colleague's goal in one sentence>
코드 N-a 진단할 <artifact>          ← runnable, broken in 2 independent ways
코드 N-b 코드 N-a의 관찰 결과        ← real output
답을 보기 전에 적습니다:
1. 기준 결과(코드 N-x)와 다른 곳을 모두 찾고, 진단 순서 몇 번으로 설명되는지
2. <the one surprising value>의 원인
3. 구조를 유지한 채 고친 <artifact>와 관찰 결과
```

Answer key: each difference → its cause → the minimal fix, plus the near-miss fix that fixes one symptom but not the
other (e.g. `COUNT(o.order_id)` fixes the empty customer but not the item-vs-order count).

**E4 — transfer with traps**

```
## 스스로 적용하기: <same skill, different surface>
코드 N-c 과제용 추가 데이터          ← plants the traps:
  - a row excluded by status (cancelled)
  - a row exactly on the half-open boundary
  - a tie that only the requested policy ranks correctly
산출물: 분해표 → 손 계산 정답표 → 중간 검산 → 최종 → 다른 구조의 두 번째 구현(diff 0)
성공 기준: 손 계산표와 출력이 행마다 같음
```

Answer key names each trap row and what it does to a copied solution.

## Length

A chapter's budget is set in toc.md (`length:`, default 25,000–35,000 characters — a typical technical-book chapter
of 20–30 pages); the elements fit inside it. Adding a missing element is exempt from the round growth cap (SKILL
stage 5), not from the budget. Padding is 🟡: production metadata or editing marks in the body (element-location
tables, reviewer notes), a block repeated whole instead of referenced, material from outside the chapter's
`requires:`..`exit:` scope.

## Readability

Depth must not cost the non-major: one running example per chapter, a new term or construct explained before the
code that uses it, at most one new idea per section, and no construct used in an exercise that the chapter or
`requires:` did not teach (🔴 at review). The reader check reports where a blind reader stalled; a stall is 🟡.
