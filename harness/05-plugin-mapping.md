# 05. Plugin / Skill Mapping

이 레포의 plugin/skill을 하네스 단계별로 매핑한다. **선택적으로 적용** — 모든 단계에서 모든 skill을 호출할 필요 없다. *지금 가장 약한 부분*에 하나만 호출하는 게 가장 큰 효과를 낸다.

## 5.1 호출 원칙

1. **단계마다 1차 skill 1개** + 필요 시 보조 skill.
2. **워크플로우 skill은 entry point** — 사이클 처음에 한 번. 그 안에서 sub-skill로 분기.
3. **결정 직전에는 think 계열** — `decision-maker`, `devils-advocate`, `problem-reframer`.
4. **완료 직전에는 verification** — `verification-before-completion`.

## 5.2 Product Track 매핑

| 단계 | 1차 skill | 보조 skill |
|---|---|---|
| 사이클 시작 (전체 사이클 가이드) | `pm:pm-strategy-workflow` | — |
| Persona / JTBD | `pm:customer-research-synthesis` | `pm:user-story` |
| Service Concept | `pm:hypothesis-driven-dev` | `pm:contagious` (확산성 점검 시) |
| Requirements 수집 | `pm:customer-research-synthesis` | `pm:product-discovery`, `pm:inspired-pm` |
| SRS / RFP 작성 | `write:doc-coauthoring` | `pm:prd-development` |
| User Journey Map | `pm:user-story-mapping` | `pm:user-story-mapping-workshop` (대화형) |
| MVP Scope 정의 | `pm:feature-prioritization` | `pm:shape-up`, `pm:user-story-splitting` |
| 검증 게이트 1 (Loop 1) | `pm:hypothesis-driven-dev` | `pm:metrics-interpretation` (결과 해석) |

### 보조 — 비기능적/전략적 영역

| 필요 | skill |
|---|---|
| 경쟁사 분석 | `pm:competitive-analysis` |
| 가격 전략 | `pm:pricing-monetization-strategy` |
| 출시 계획 | `pm:go-to-market-planning` |
| 출시 후 회고 | `pm:post-launch-retrospective` |
| 기술 실현 가능성 사전 점검 | `pm:technical-feasibility-assessment` |
| 스토리 쪼개기 | `pm:user-story-splitting` |

## 5.3 Tech Track 매핑

| 단계 | 1차 skill | 보조 skill |
|---|---|---|
| 사이클 시작 (전체 dev 사이클) | `develop:dev-quality-workflow` | — |
| 아키텍처 설계 | `develop:architecture-designer` | `develop:architecture-workflow`, `develop:clean-architecture` |
| 도메인 모델링 | `develop:domain-driven-design` | `develop:event-storming` |
| 서비스 경계 확정 | `develop:service-boundary-validator` | — |
| 기술 스택 결정 | `develop:architecture-designer` | `pm:technical-feasibility-assessment` |
| Design Doc 작성 | `technique-write:design-review-writer` | `write:doc-coauthoring` |
| ADR 작성 | `technique-write:adr-writer` | — |
| DB 설계 | `develop:database-workflow` | `develop:sql-pro`, `develop:database-optimizer` |
| 트랜잭션 경계 점검 | `develop:transaction-boundary-reviewer` | — |
| 검증 게이트 2 (Loop 2) | `develop:test-driven-development` | `develop:chaos-engineer`, `develop:performance-profiling-optimization` |

### 보조 — 운영·품질 영역

| 필요 | skill |
|---|---|
| 운영 준비 | `develop:operations-workflow` |
| 마이크로서비스 아키텍처 | `develop:microservices-architect` |
| MSA 회로차단 튜닝 | `develop:circuit-breaker-tuner` |
| DB 커넥션 풀 튜닝 | `develop:connection-pool-tuner` |
| Docker 최적화 | `develop:dockerfile-optimizer` |
| 테스트 전략 | `develop:testing-workflow`, `develop:test-master` |
| Flaky 테스트 분석 | `develop:flaky-test-analyzer` |
| 인시던트 대응 | `develop:incident-response-playbook` |
| 코드 문서화 | `develop:code-documenter`, `develop:documentation-strategy` |

## 5.4 사고·결정 계열 (Cross-cutting)

언제든 호출 가능. 특히 *결정 직전*에 의도적으로 끼워넣는다.

| 상황 | skill |
|---|---|
| 무엇을 만들지 모름 — 발산 | `think:brainstorming` |
| 문제 정의 자체 의심 | `think:problem-reframer` |
| 옵션 중 고르기 | `think:decision-maker` |
| 강한 끌림 점검 — 약점 찾기 | `think:devils-advocate` |
| 사이클 회고 | `think:retrospective` |
| 머릿속 정리 | `think:thought-organizer` |
| 처음부터 다시 생각 | `think:first-principles` |
| 깊이 사고 워크플로우 | `think:deep-thinking-workflow` |
| UX 미세 인터랙션 설계 | `think:microinteractions` |
| 비판적 사고 사이클 | `cognition:critical-thinking-workflow` |
| 편향 점검 | `cognition:bias-auditor` |
| 가정 추출 | `cognition:assumption-extractor` |
| Trade-off 명료화 | `cognition:tradeoff-articulator` |
| 2차 결과 사고 | `cognition:second-order-thinker` |
| 멘탈 모델 적용 | `cognition:mental-model-toolkit` |
| 인식론적 점검 | `cognition:epistemic-reasoner` |
| 논리 오류 점검 | `cognition:fallacy-detector` |
| 질문 자체 개선 | `cognition:question-upgrader` |
| 사고 명료성 | `cognition:clarity-toolkit` |

## 5.5 문서 / 작성 보조

| 상황 | skill |
|---|---|
| 문서 검토·교정 | `write:writer-verification` |
| 새로운 skill 작성 | `write:writing-skills` |
| 기술 블로그 | `write:technical-blog-writer` |
| 동료 피드백 작성 (SBI) | `write:sbi-writer` |
| 계획 문서 작성 | `write:writing-plans` |
| 계획 실행 | `planning:executing-plans` |

## 5.6 사이클 시작 시 — 추천 호출 순서

새 제품/기능 사이클을 시작할 때:

```
1. think:brainstorming                       # 무엇을 만들지 발산
2. pm:pm-strategy-workflow                   # PM 사이클 전체 진입
   ├─ pm:customer-research-synthesis         # Persona 단계
   ├─ pm:hypothesis-driven-dev               # 가설 작성
   ├─ pm:user-story-mapping                  # UJM
   └─ pm:feature-prioritization              # MVP scope
3. think:devils-advocate                     # 검증 직전 결정 점검
4. (검증 게이트 1 통과)
5. develop:dev-quality-workflow              # Dev 사이클 진입
   ├─ develop:architecture-designer          # 아키텍처
   ├─ technique-write:design-review-writer   # Design Doc
   ├─ technique-write:adr-writer             # ADR (반복)
   ├─ develop:database-workflow              # DB
   └─ develop:test-driven-development        # 검증 게이트 2
6. think:retrospective                       # 사이클 종료 후
```

## 5.7 가장 자주 잊는 5가지

경험적으로 사이클이 돌 때 *자주 누락*되는 skill 호출:

1. **`cognition:bias-auditor`** — 한 옵션이 너무 매력적으로 보일 때
2. **`pm:user-story-splitting`** — 스토리가 한 sprint에 안 들어갈 때
3. **`develop:transaction-boundary-reviewer`** — 분산 트랜잭션 흔적이 보일 때
4. **`develop:incident-response-playbook`** — *출시 전*에 한 번 점검
5. **`think:retrospective`** — 사이클 종료 후 (가장 자주 건너뜀)

## 5.8 호출 안 해야 할 때

- *이미 결정이 끝난 단계*에서 다시 발산 skill을 호출 → 의사결정 마비
- *코드 작성 중*에 brainstorming → 디자인 단계로 돌아가야 한다는 신호
- *trivial한 작업*에 워크플로우 skill → overkill, 시간 낭비
- 한 사이클에 5개 이상의 skill 호출 → 너무 많음, 우선순위 부재
