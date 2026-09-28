# fit — run-it comparison (US-1, AC1.6 / AC1.7)

Method: each run is a fresh general-purpose subagent (same model as the implementer, one run per side). It was given only the skill under test and the fixture, with no PRD and no diff. New = `portfolio/skills/fit/SKILL.md` + `references/company-type-profiles.md`. Baselines = `git show cbdfcd6:portfolio/skills/jd-fit/SKILL.md` and `git show cbdfcd6:portfolio/skills/portfolio-company/SKILL.md`, snapshotted before deletion. Fixtures: `portfolio/skills/fit/evals/files/resume-backend-kr.md` (a) and `jd-fintech-senior-backend.md` (b). Condition (c) is (a) with no posting and no company named. The prompts are the ones in `portfolio/skills/fit/evals/evals.json`.

The rerun rule follows the plan critique: a mismatch gets one rerun of both sides, the same clause P3 has (default - revisit).

## (i) JD mode: fit vs cbdfcd6 jd-fit, fixtures (a)+(b)

### Run 1: mismatch

| | new fit | baseline jd-fit |
|---|---|---|
| Opening verdict | `**경계.** 반드시 충족해야 할 자격요건 5개 중 3개는 경력기술서 문장으로 확인됩니다 … 나머지 2개는 요건의 일부만 문장으로 드러납니다. Java·Spring Boot 서비스 운영(G2)과 RDBMS 설계(G1)입니다.` | `**통과.** 자격요건 5개 중 완전히 빠진 항목은 없습니다(치명적 갭 0). … 다만 must-have 3개(G1, G2, G6)는 부분 충족입니다.` |
| Dimensions (스택/스케일/역할/도메인/소프트) | 7 / 5 / 5 / 8 / 5 | 8 / 5 / 5 / 7 / 5 |
| Tally | `판정 경계 · 5개 차원 6/10 · 치명적 0 · 보완 가능 5 · 마이너 3 · must-have 미충족 2/5`, then a parenthetical note after it | `판정 통과 · 5개 차원 6/10 · 치명적 0 · 보완 가능 6 · 마이너 3 · must-have 미충족 0/5` |

Diagnosis: the two runs agreed on the facts: 치명적 0, and 부분 충족 on Spring Boot 운영 and RDBMS 설계. They split on whether a partly evidenced must-have counts in `must-have 미충족 n`. jd-fit never defines `n`, so the verdict followed whichever count each run used. The new run also put a note after the tally line.

Fix in `fit/SKILL.md` (Standing Mandates, JD-mode Goal, and Output 집계). `n` is the must-haves with no evidence at all, which are the 치명적 must-have gaps. A partly evidenced must-have is a 보완 가능 gap labelled 부분 충족 and is not counted in `n`. The tally is the last line and nothing follows it. This makes explicit jd-fit's own Beam A definition (치명적 = missing a must-have). It does not add a new rule. No-JD mode text was not touched, so the no-JD runs below were not repeated.

### Run 2 (rerun of both sides, after the fix): parity

| | new fit | baseline jd-fit |
|---|---|---|
| Opens with | `**[서류 통과 가능성]**` / `**통과**. 자격요건 5개가 모두 근거가 있는 불릿과 연결되고, 치명적 갭은 없습니다.` | `**[서류 통과 가능성]**` / `**통과.** 자격요건 5개 중 완전히 비어 있는 항목은 없습니다.` |
| Swing factor | `시니어 신호(G5)입니다. 코드 리뷰나 멘토링을 한 실제 경험이 한 줄 들어가면 확실한 통과 쪽으로 기웁니다.` | `"결제 모듈 리팩토링에 참여하여 코드 품질 향상에 기여" 한 줄(G1)이 가장 큽니다.` |
| 기술 스택 | 7/10 | 8/10 |
| 경험 스케일 | 6/10 | 6/10 |
| 역할 범위 | 5/10 | 5/10 |
| 도메인 | 8/10 | 7/10 |
| 소프트 시그널 | 5/10 | 6/10 |
| "API 응답속도 개선" | `"API 응답속도 개선" 한 줄은 수치 없이 다음 불릿과 중복됩니다 [확인 필요: 별개 개선이라면 개선 전/후 수치]`. It is not a match. | `"API 응답속도 개선"은 바로 아래 p95 bullet과 내용이 겹칩니다. 지우거나 p95 bullet의 제목으로 합치세요.` It is not a match, but there is **no** `[확인 필요]` marker. |
| Last line | `판정 통과 · 5개 차원 6.2/10 · 치명적 0 · 보완 가능 5 · 마이너 3 · must-have 미충족 0/5` | `판정 통과 · 5개 차원 6.5/10 · 치명적 0 · 보완 가능 6 · 마이너 3 · must-have 미충족 0/5`, then `(must-have 5개 중 부분 충족이 3개입니다: G1, G2, G3)` |

Result:
- The verdict is the same (통과).
- must-have 미충족 is the same (0/5).
- Every dimension is within ±1.
- The new output opens with 서류 통과 가능성 and ends with the tally line.
- In both outputs, `API 응답속도 개선` is never counted as a match.

One criterion is not met by the baseline, and I am recording it as observed: the cbdfcd6 jd-fit run did not mark `API 응답속도 개선` with `[확인 필요: …]` in either run. Its run-1 wording was `첫 bullet "API 응답속도 개선"은 … 수치도 없습니다. 지우세요.`. The new fit output marks it in both runs. Run 1 of new fit: `[확인 필요: p95 개선과 별개의 성과인지, 별개라면 개선 전/후 수치]`.

## (ii) No-JD mode: fit vs cbdfcd6 portfolio-company, fixture (a) under (c)

One run each, and parity held on the first run.

| | new fit | baseline portfolio-company |
|---|---|---|
| Opens with | `**[가장 잘 맞는 회사 유형 Top 2 / 피해야 할 회사 유형]**` | `**[가장 잘 맞는 회사 유형 Top 2 / 피해야 할 회사 유형]**` |
| Top 1 | `성장기 스타트업, 특히 커머스·결제 도메인 (강한 상호 핏)` | `핀테크 / 결제·정산 도메인이 핵심인 회사.` |
| Top 2 | `핀테크 / 엔터프라이즈 (지원 가능, 상호 핏은 운영 증거에 달림)` | `성장기 스타트업, 특히 커머스·주문·결제가 핵심 사업인 곳.` |
| Type to avoid | `개발 도구 / 플랫폼 / 오픈소스 팀` | `개발 도구 / 플랫폼 / 오픈소스 팀.` |
| 핏 점수 (스타트업 / 핀테크 / 대형 플랫폼 / 글로벌 / 개발도구) | 7 / 6 / 5 / (not scored) / 2 | 6 / 7 / 5 / 3 / 2 |
| Per-type blocks | 핏 점수 / 이 유형에서 강한 이유 / 이 유형에서 약한 이유 / 지원 전 보완할 것, for every type | same four fields, for every type |
| Non-negotiables | `[확인 필요: 근무지 / 도메인 / 스택 조건]` | `[확인 필요: 근무지 / 도메인 / 스택 조건]` |
| 판정 tally line | none | none |
| Company facts not in input | none. Its only company-specific line is `[확인 필요: (주)커머스랩 규모 / 투자 단계]` | none. It uses `[확인 필요: 지원 회사 채용공고 기술스택]` |

Result:
- The Top 2 set is the same, {성장기 스타트업, 핀테크/엔터프라이즈}. The order differs, which the criterion allows.
- The type to avoid is the same (개발 도구 / 플랫폼 / 오픈소스 팀).
- The new output opens with Top 2 + type to avoid.
- It has the four per-type fields and no tally line.
- Neither run states a company fact that the input did not contain.

Both no-JD runs kept `API 응답속도 개선` unfilled. New: `[확인 필요: 아래 p95 항목과 같은 성과인지, 별개라면 개선 전/후 수치]`. Baseline: it recommends merging the line with the p95 bullet and gives no number.

## Attempt 3: re-run after the unmeasured-line fix (supersedes the runs above for acceptance)

Why: an independent re-run of the attempt-2 skill showed that new fit sometimes wrote `"API 응답속도 개선" … 지우거나 p95 bullet에 합칩니다` with no `[확인 필요]` marker. The attempt-2 regex also matched a marker that belonged to a different sentence on the same line.

Fixes in `fit/SKILL.md`:
- Standing Mandates L35: every unmeasured line is quoted with `[확인 필요: ○○]` right after the quote, including a line that looks redundant or like a heading. "Delete/merge" without the marker is a violation.
- Process JD step 2 (L79): an "Unmeasured lines" list. Company-type step 1 (L98) reuses it.
- Output: a **수치 없는 줄** list closes 포지셔닝 조정 (L151–152) and 포지셔닝 제안 (L181).
- Company-type mandate (L55): the `[확인 필요: 근무지 / 도메인 / 스택 조건]` marker is the ask for non-negotiables. The answer must not open with a question or a preamble. The first no-JD run of attempt 3 opened with a question paragraph, so the new side was re-run once under the rerun rule. The baseline was not re-run.

`evals.json` `unmeasured-line-flagged` now requires the marker right after the quoted line: `API 응답속도 개선["”']?\s*`?\[확인 필요:`.

Each side is a fresh general-purpose subagent, same model. It read only the skill file(s) and the fixture(s), and used the eval prompts from `evals.json`.

### (i) JD mode, fixtures (a)+(b)

| | new fit | baseline cbdfcd6 jd-fit |
|---|---|---|
| Opens with | `**[서류 통과 가능성]**` / `` `통과`: 자격요건 5개 중 증거가 아예 없는 항목은 없습니다. 3개는 그대로 충족하고, 2개는 일부만 드러나 있습니다(G1 Spring Boot 운영, G2 RDBMS 설계, 둘 다 부분 충족·보완 가능).`` | `**[서류 통과 가능성]**` / `**통과** — 자격요건 5개가 모두 경력기술서 bullet로 뒷받침되고 치명적 갭은 없습니다.` |
| Swing factor | `거래 규모 수치(G3)입니다.` | `커머스랩 주문/결제 시스템의 트래픽·거래 규모(G1).` |
| 기술 스택 / 경험 스케일 / 역할 범위 / 도메인 / 소프트 시그널 | 7 / 5 / 5 / 7 / 5 | 7 / 5 / 5 / 7 / 5 |
| "API 응답속도 개선" | `- "API 응답속도 개선" `[확인 필요: 개선 전/후 수치 — 아래 주문 API p95 bullet과 별개 성과인지]`: 매칭 아님` | `대응 방법: "API 응답속도 개선"은 삭제하세요(다음 줄과 중복).` The line is not a match, but it gets no `[확인 필요]` marker. |
| Last line | `판정 통과 · 5개 차원 6/10 · 치명적 0 · 보완 가능 4 · 마이너 4 · must-have 미충족 0/5` | `판정 통과 · 5개 차원 6/10 · 치명적 0 · 보완 가능 6 · 마이너 3 · must-have 미충족 0/5` |
| evals.json eval 1 | 7/7 assertions pass | 6/7. `unmeasured-line-flagged` fails |

Result:
- The verdict is the same (통과).
- must-have 미충족 is the same (0/5).
- All five dimensions are identical, which is within ±1.
- New fit opens with 서류 통과 가능성 and ends with the tally line, with nothing after it.
- Neither output counts `API 응답속도 개선` as a match.
- New fit marks it `[확인 필요: …]`.

The frozen cbdfcd6 jd-fit baseline recommends deleting the line without a marker. It has done this in all three runs so far (attempt 2 runs 1–2, attempt 3). Its own mandate asks for the marker (cbdfcd6 jd-fit L40), but it does not require the marker on a line that looks redundant. That is the gap attempt 3 closes in fit. The baseline file is fixed input and is not edited here. So the "both outputs" half of that criterion holds only for new fit (default - revisit).

### (ii) No-JD mode, fixture (a) under condition (c)

| | new fit (attempt-3 rerun) | baseline cbdfcd6 portfolio-company |
|---|---|---|
| First line | `**[가장 잘 맞는 회사 유형 Top 2 / 피해야 할 회사 유형]**` | a preamble question paragraph (`점수를 매기기 전에 먼저 여쭤볼 게 있습니다. **꼭 지켜야 하는 조건**…`), then the Top 2 block at L7 |
| Top 1 | `핀테크 / 엔터프라이즈 (결제·정산을 핵심으로 하는 조직)` | `핀테크 / 결제·정산 중심 조직 (7/10)` |
| Top 2 | `성장기 스타트업 (특히 커머스, Series B–D)`. "Series B–D" comes from the type profile, not from a company fact | `성장기 스타트업, 특히 커머스 도메인 (6/10)` |
| Type to avoid | `개발 도구 / 플랫폼 / 오픈소스 팀` | `개발 도구 / 플랫폼 / 오픈소스 팀 (2/10)` |
| 핏 점수 (핀테크 / 스타트업 / 대형 플랫폼 / 개발도구) | 7 / 7 / 5 / 2 | 7 / 6 / 5 / 2 (글로벌 4) |
| Per-type fields | 핏 점수 / 강한 이유 / 약한 이유 / 지원 전 보완할 것, for all four types | same four fields |
| Non-negotiables | `[확인 필요: 근무지 / 도메인 / 스택 조건]` in 핵심 신호 | same marker |
| 판정 tally line | none | none |
| "API 응답속도 개선" | `- "API 응답속도 개선" `[확인 필요: 대상 API와 개선 전/후 수치 — 아래 주문 API p95 bullet과 별개 성과인지]` — 근거 아님` | `"API 응답속도 개선"은 바로 아래 p95 줄과 겹치니 합치거나 지우세요.` It gives no number. |
| Company facts not in input | none. No company is named | none |
| evals.json eval 2 | 6/6 assertions pass | 5/6. `opens-with-top2-and-avoid` fails because of the preamble |

Result:
- The Top 2 set is the same, {핀테크/엔터프라이즈, 성장기 스타트업}.
- The type to avoid is the same.
- New fit opens with Top 2 + type to avoid, has the four per-type fields, and has no tally line.
- Neither run states a company fact that was absent from the input.

The discarded attempt-3 run 1 of new fit opened with a question paragraph, just as the baseline does. Its Top 2 and type to avoid were the same as the baseline's (핀테크/엔터프라이즈, 성장기 스타트업; avoid 개발 도구/플랫폼/OSS). It also passed 5/6 assertions.
