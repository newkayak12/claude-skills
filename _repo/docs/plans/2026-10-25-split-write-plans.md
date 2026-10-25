# write:plans를 PRD · ADR · 요구사항 분석으로 나누고 teams에 넣기

카드 47. 결정(사용자, 2026-10-25): "write:plan을 prd, adr, 요구사항 분석으로 나누고 각각 핏하게
해서 teams에 넣고". 그 전: "writeplan이 티켓을 나누는데 특화인지는 모르겠어 -> 나누는게 나을지도".

## 지금

`write:plans` 하나가 Step 0에서 용도 6개 중 하나를 고른다: 구현 계획(기본), document(PRD·설계
문서·RFC), design review, ADR, blog, feedback. teams는 이 스킬 하나를 세 곳에 붙인다
(`teams/mcp/graph.mjs`): `document.draft`, `planning.draft`, `planning-light.template-fill`.
요구사항 분석은 어디에도 없다. teams `planning.investigate`가 출처를 읽지만 분석 결과의 형식은
없다.

## 나누는 모양

| 스킬 | 맡는 것 | 출처 | 끝 |
|---|---|---|---|
| `write:requirements` (새) | 요구사항·기획서 → 관련자, 규칙, 미정 사항, 따로 끝낼 수 있는 작업 단위와 단위별 완료 기준(AC-n) | 없음 (새로 씀) | 분석 문서. 구현·티켓은 하지 않는다 |
| `write:prd` (새) | PRD, 설계 문서, RFC, 제안서 | `plans/references/document.md`, `agents/reader-agent.md`, reader testing | 독자 검증을 통과한 문서 |
| `write:adr` (새) | ADR(결정 기록)과 design review(대안 비교) | `references/formats/adr*.md`, `design-review*.md` | 고정 양식 문서 |
| `write:plans` (남음) | 구현 계획·티켓 분해, blog, feedback | 나머지 | 지금과 같다 |

- 각 스킬은 자기 용도만 트리거하고 Step 0 질문이 없다. `write:plans`의 Step 0 표는 남은 셋만 고른다.
- 공통 부분(섹션 루프, gap/ambiguity 점검)은 복사하지 않는다. 한 곳에 두고 나머지는 경로로 가리킨다.
- `write:plans`가 이미 받는 hand-off(brainstorming, executing-plans, harness)는 그대로 구현 계획으로 간다.

## teams에 넣는 곳

| teams 단계 | 지금 | 바꾼 뒤 |
|---|---|---|
| `planning.investigate` | `develop:domain-driven-design`, `cognition:assumption-extractor` | + `write:requirements` (분석 결과를 draft가 받는다) |
| `planning.draft` | `write:plans` | `write:prd` |
| `planning-light.template-fill` | `write:plans` | `write:prd` |
| `document.draft` | `write:plans` | 요청이 ADR·design review면 `write:adr`, 아니면 `write:prd` |

teams의 PRD 계약(`prompts.mjs` PRD_CONTRACT, AC-n)은 바꾸지 않는다. `write:requirements`의 단위별
AC-n은 그 계약과 같은 id 형식(`<area>-AC-n`)을 쓴다.

## 완료 기준

1. 새 스킬 셋이 `check-skeleton` 0 problems, validator·check-copies 통과.
2. 트리거 확인: 대표 문장마다 맞는 스킬이 뜬다("PRD 써줘"→prd, "ADR 남겨줘"→adr,
   "기획서 쪼개줘"→requirements, "구현 계획 써줘"→plans). 한 번씩 실제로 돌려 본다.
3. `write:requirements`를 예시 기획서(가짜)로 한 번 실제로 돌려 본다.
4. teams `graph.mjs` 마운트 변경과 테스트, `node --test teams/scripts/test-*.mjs` 통과.
5. write minor bump(스킬 추가), teams patch.

## 정해야 할 것

- 새 스킬을 `write` 플러그인에 둘지, 요구사항 분석만 `planning`에 둘지. 제안: 셋 다 `write`
  (문서를 쓰는 일이고, 원래 `write:plans`에서 나왔다).
