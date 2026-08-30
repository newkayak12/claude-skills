# write — 한국어

[English](README.md) · **한국어**

엔지니어가 실제로 써야 하는 것들을 위한 글쓰기 스킬입니다 — design doc과 PRD, 구현 계획, 블로그
글, 동료 피드백, 그리고 다른 스킬을 움직이는 SKILL.md. 전부 프롬프트가 아니라 프로세스입니다.
컨텍스트 먼저, 구조 다음, 문장은 마지막. 그중 둘(`writing-plans`, `writing-skills`)은
harness-aware입니다 — 혼자 돌리면 문서를 내고, `harness:harness` 실행이 몰고 있으면 기계가 읽는
스펙을 냅니다.

## 설치 / 제거

```bash
/plugin install write@newkayak12-claude-skills
/plugin uninstall write@newkayak12-claude-skills
```

## 어떤 스킬을 쓰나

| 하고 싶은 것 | 스킬 |
|---|---|
| 남이 읽을 큰 문서(PRD, design doc, RFC) 같이 쓰기 | `doc-coauthoring` |
| 코드 건드리기 전에 여러 단계짜리 구현 계획 세우기 | `writing-plans` |
| SKILL.md 쓰거나 고치기 | `writing-skills` |
| 만들거나 고친 것을 기술 블로그로 쓰기 | `technical-blog-writer` |
| 동료에게 쏘지 않고 닿는 피드백 쓰기 | `sbi-writer` |
| 이미 쓴 글 검토하고 고치기 | `writer-verification` |

knowledge-base, knowledge-graph, RAG corpus, knowledge-query 스킬은 이제 `knowledge` 플러그인에
있습니다.

## 스킬

### `doc-coauthoring`

남이 읽을 문서를 3단계로 씁니다. **Context Gathering**(맥락 덤프 + 번호 붙은 5~10개 확인 질문),
**Refinement & Structure**(섹션 하나씩 — 질문 → 5~20개 옵션 발산 → 사용자가 취사선택 → 초안 →
부분 수정), **Reader Testing**(작성 맥락이 전혀 없는 새 Claude가 예상 독자 질문에 답해보며 사각지대
노출). 전 섹션을 미리 쓰지 않고, 주 독자가 누구인지 모르는 채로는 시작하지 않습니다.

```
새 검색 서비스 design doc 같이 쓰자. 독자는 인프라 팀이고,
왜 Elasticsearch 대신 직접 인덱싱하는지 설득해야 해.
```

문서마다 나오는 것: 문서 구조, 섹션별 초안, 명확성·누락에 대한 리뷰 코멘트, 수정 로그. Claude
Code에서는 Reader Testing이 `agents/reader-agent.md` 서브에이전트로 돌고, claude.ai에서는
`references/manual-reader-testing.md`로 대체됩니다.

### `writing-plans`

구현 계획만 만들고 실행은 절대 하지 않습니다. `planning:executing-plans`가 인계 시점에 하던 갭
체크와 모호성 체크를 여기서, 작성 시점에 합니다 — 계획이 완성되려면 모든 단계에 관측 가능한 pass
bar가 하나씩 찍혀 있어야 합니다. staleness/drift는 일부러 범위 밖입니다. 그건
`planning:executing-plans`가 맡습니다.

```
결제 웹훅 재시도 로직 구현 계획 써줘. 기존 PaymentEventHandler 건드리는 범위까지 포함해서,
태스크마다 어떤 테스트가 통과해야 끝인지 명시해줘.
```

**Dual-mode.** 같은 프로세스, 두 가지 산출 형태:

| 모드 | 산출물 | 소비처 |
|---|---|---|
| Solo | `docs/plans/YYYY-MM-DD-<feature>.md` 계획 문서, 단계별 pass bar | `completion:verification-before-completion` |
| Harness-engaged | SetGoal goal-spec — `acceptance[]` / `test[]`를 가진 subgoal | harness QualityGate (subgoal → goal 레벨) |

Solo 모드의 태스크 형태:

```markdown
### Task N: [Component]
**Files:** create/modify/test — exact paths.
**Interfaces:** consumes [earlier tasks' signatures] / produces [names later tasks rely on].
**Pass bar:** [이 단계가 끝났음을 증명하는 관측 가능한 검사 하나]

- [ ] 1: failing test (full code) → 2: confirm it fails → 3: minimal implementation
  (full code) → 4: confirm it passes → 5: commit
```

### `writing-skills`

컨벤션에 맞는 `SKILL.md`를 쓰되 자기 결과물을 스스로 채점하지 않습니다 — 트리거 커버리지는
`skill:skill-trigger-validator`, 출시 전 검사는 `skill:skill-quality-assurance`에 넘깁니다. TDD
모양을 문서에 빌려옵니다: 그 스킬이 *없을 때* 에이전트가 잘못 행동하는 시나리오를 만들고, 그게
진짜 갭임을 확인한 뒤, 그 갭을 막는 가장 작은 초안을 씁니다. 확인된 갭이 없으면 초안도 없습니다.

```
harness 실행 로그에서 실패 원인 요약하는 패턴을 skill로 만들어줘.
description이 "Use when"으로 시작하게 하고, 트리거 검증까지 돌려줘.
```

**Dual-mode.** 같은 네 동작, 두 레인:

| 동작 | Solo | Harness-engaged |
|---|---|---|
| 갭 정하기 | 기억이나 수동 프로브로 직접 지목 | SetGoal의 acceptance criteria가 이미 명시 |
| 초안 | 직접 SKILL.md 작성 | Implement 실행자가 subgoal 기준에 맞춰 작성 |
| 트리거 검사 | 직접 `skill:skill-trigger-validator` 호출 | QualityGate가 subgoal 채점 중 호출 |
| 출시 게이트 | 직접 `skill:skill-quality-assurance` 호출 후 반영 | QualityGate가 호출, 실패 리포트는 subgoal을 막음 |

harness 파이프라인이 이 작업을 넘겼다면 harness-engaged, 아니면 solo로 보고 두 게이트를 직접
돌리세요. 출시에는 `.claude-plugin/marketplace.json` 버전 bump, 해당 플러그인 README 갱신,
`scripts/validate_plugins.py` 재실행이 포함됩니다.

### `technical-blog-writer`

3단계입니다. 핵심 스토리 추출(무엇을 만들었나 / 뭐가 의외였나 / 독자가 읽고 뭘 다르게 할까 — 세
답이 다 나오기 전엔 초안 금지), 고정된 아크로 아웃라인, 그다음 초안과 다듬기. 아크는 Hook →
Problem in Depth → Solution → Results → What You'd Do Differently → Conclusion + CTA이고, 해결
과정은 깔끔한 설명서 순서가 아니라 실제로 발견한 순서로 씁니다.

```
Kafka consumer lag를 40초에서 2초로 줄인 과정을 기술 블로그로 쓰고 싶어.
파티션 재설계가 핵심이었고, 처음엔 컨슈머 수만 늘려서 실패했어.
```

분량 가이드:

| 주제 유형 | 목표 |
|---|---|
| 짧은 팁·단일 개념 | 400–700 words |
| 문제/해결 서사 전체 | 1,000–1,800 words |
| 심층 분석·튜토리얼 | 2,000–3,500 words |
| 시리즈 한 편 | 편당 1,000–1,500 words |

### `sbi-writer`

피드백을 Situation → Behavior → Impact로 다시 씁니다. 특정한 한 순간, 카메라 테스트를 통과하는
관찰 가능한 행동, 그리고 "나/우리" 시점에서 말한 실제 결과. 원문에서 관찰과 판단을 분리하고,
해석이나 성격 규정은 다시 쓰도록 표시합니다. 칭찬도 마찬가지입니다 — 뭉뚱그린 칭찬은 상대가 뭘
반복해야 할지 알려주지 못합니다.

```
팀원이 스프린트 리뷰에서 준비 없이 발표해서 고객 미팅이 밀렸어.
비난처럼 안 들리게 피드백 문장 만들어줘.
```

자주 잡는 실패:

| 실수 | 고침 |
|---|---|
| 판단을 행동인 척 ("무책임하게 행동했다") | "마감 전날 아무 공지 없이 작업을 제출하지 않았다" |
| 모호한 상황 ("항상 회의에서") | "지난 화요일 스프린트 플래닝에서" |
| 영향 누락 ("그건 별로였어") | "팀이 다음 스텝을 못 정하고 하루를 낭비했다" |
| 여러 행동 몰아치기 | SBI 하나당 행동 하나 |

### `writer-verification`

이미 쓴 글을 네 개의 패스로 검토합니다 — 맞춤법·문법, 글쓰기 패턴, 표현·스타일, 독자 관점. 핵심
규칙: 모든 지적은 원문 → 수정안 + 이유를 함께 냅니다. 고치지 않고 지적만 하면 리뷰의 절반입니다.
300자 미만이면 인라인으로 순차 실행, 300자 이상이면 네 패스(`grammarian`, `editor`,
`copywriter`, `reader`)를 병렬 서브에이전트로 띄운 뒤 집계합니다 — 위치별 중복 제거, 심각도 충돌은
높은 쪽으로, 수정안 충돌은 출처를 붙여 둘 다 제시.

```
릴리스 노트 초안이야. 사내 공지로 나갈 거라 딱딱하지 않으면서 정확해야 해.
어색한 표현이랑 논리 비약 잡아줘.
```

우선순위는 🔴 반드시 수정(의미 오류, 논리 공백) · 🟡 권장(패턴, 표현) · 🟢 선택(스타일 취향)입니다.

## MCP

이 플러그인의 스킬은 모두 MCP 도구를 optional 또는 recommended로 둡니다. 필수는 없습니다:

| 스킬 | 도구 | 용도 |
|---|---|---|
| `doc-coauthoring` | think-tool | 어느 섹션에 미지수가 가장 많은지 판단 |
| `writing-plans` | sequential-thinking, think-tool | 의존성 사슬 추적, 단계가 정말 모호하지 않은지 판정 |
| `writing-skills` | think-tool | RED 단계 압박 시나리오 설계 |
| `technical-blog-writer` | think-tool | 초안 전에 핵심 스토리와 각도 확정 |
| `sbi-writer` | think-tool | 관찰과 판단 구분이 애매한 케이스 |
| `writer-verification` | think-tool, sequential-thinking, mcp-reasoner | 패스 구조화, 상충하는 지적 조정 |

Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
