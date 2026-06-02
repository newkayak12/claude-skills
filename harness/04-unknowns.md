# 04. Unknowns — 개발자가 잘 모를 만한 프레임워크

개발자(특히 1인)는 코드/시스템 측 지식은 깊지만, 다음 영역은 종종 *이름만 들어보고* 실전에서 적용하지 않는다. 각 항목은 *짧게* 정리하고, 어디서 더 파볼지의 포인트를 남긴다.

## 4.1 Continuous Discovery (Teresa Torres)

### 핵심 주장

Discovery는 *프로젝트 시작 단계*에서만 하는 게 아니라 *주간 리듬*으로 계속 한다. 매주 고객 인터뷰 *최소 1건*을 제품팀 모두가 진행.

### Opportunity Solution Tree (OST)

목표를 시각화하는 트리:

```
                  Outcome (북극성 metric)
                        │
        ┌───────────────┼───────────────┐
   Opportunity1   Opportunity2   Opportunity3   ← 고객의 통점·욕구
        │              │               │
   ┌────┼────┐    ┌────┴────┐     ┌────┼────┐
  Sol1 Sol2 Sol3  Sol4    Sol5   Sol6 Sol7 Sol8  ← 해법 후보 (다양성 핵심)
        │
    Experiment   ← 해법을 검증할 실험
```

**핵심 원칙**:
- Opportunity는 *고객 언어로* 기술. 해법으로 쓰면 안 됨.
- 각 Opportunity 아래 *해법은 다수* — 하나만 떠올랐다면 발산 부족.
- 모든 해법은 *실험으로 검증*되어야 다음으로 넘어감.

### 1인 개발자 적용

매주 인터뷰 1건은 무리지만, **격주 1건**은 현실적. OST를 그리면 *내가 어떤 가정 위에서 일하는지*가 시각화되어, 검증되지 않은 가정이 한 눈에 보임.

## 4.2 Four Product Risks (Marty Cagan, *Inspired*)

모든 제품 결정은 4가지 리스크 중 하나 이상을 줄여야 한다:

| 리스크 | 질문 | 검증 책임 |
|---|---|---|
| **Value** (가치) | 고객이 살까/쓸까? | PM / Product |
| **Usability** (사용성) | 쓸 수 있을까? | Design |
| **Feasibility** (실현가능성) | 우리가 만들 수 있을까? | Engineering |
| **Viability** (사업성) | 우리 비즈니스가 견디나? (법무, 마케팅, 영업, 재무) | Business |

→ 1인 개발자는 4개를 *모두* 자기가 검증해야 함. *어떤 리스크가 가장 큰가*를 매 사이클 시작 시 명시.

## 4.3 NFR Taxonomy

### FURPS+ (HP, 1992)
- **F**unctionality (기능 외 보안·상호운용)
- **U**sability (학습성, 효율성, 미적, 일관성)
- **R**eliability (가용성, MTBF, 정확성)
- **P**erformance (응답시간, 처리량, 자원 사용)
- **S**upportability (테스트성, 유지보수, 확장성, i18n, 설치, 모니터링)
- **+**: Design / Implementation / Interface / Operations / Packaging / Legal constraints

### ISO/IEC 25010 (제품 품질 모델)

8개 특성:
1. Functional Suitability
2. Performance Efficiency
3. Compatibility
4. Usability
5. Reliability
6. Security
7. Maintainability
8. Portability

→ FURPS+로 1차 점검 → 큰 빠짐이 있으면 ISO 25010 사용. 실무에서는 **수치를 적는 것 자체가 중요** — "빠르다"가 아니라 "P95 응답 200ms".

## 4.4 C4 Model (Simon Brown)

→ 자세한 내용은 [`02-tech-track.md`](./02-tech-track.md#21-architecture-설계) 참조.

기억 포인트: **Context → Container → Component → Code** 네 단계 zoom. *모든 단계를 그리지 않는다* — 필요한 단계까지만.

## 4.5 arc42

→ 12 섹션 체크리스트는 [`02-tech-track.md`](./02-tech-track.md#arc42--아키텍처-문서-템플릿) 참조.

arc42 vs C4:
- **C4**: 다이어그램 표기법
- **arc42**: 아키텍처 문서 *구조* (다이어그램 + 텍스트)
- 둘은 보완 — arc42 안에 C4 다이어그램을 넣는 게 표준 조합.

## 4.6 ADR Format 변종

| 형식 | 특징 |
|---|---|
| **Nygard** (원형) | Status / Context / Decision / Consequences. 가장 짧음. |
| **MADR** (Markdown ADR) | + Considered Options, Decision Drivers. 더 풍부. |
| **Tyree & Akerman** | + Constraints, Assumptions, Implications, Notes. 풀버전. |

→ 시작은 **MADR**이 균형. 너무 가벼우면 *왜*가 사라지고, 너무 무거우면 안 적게 됨.

## 4.7 Traceability Matrix

요구사항 ↔ 설계 ↔ 코드 ↔ 테스트의 **추적 가능성** 매트릭스. 표준은 IEEE 830 / IREB CPRE.

| Req ID | Description | Design Section | Code Module | Test Case |
|---|---|---|---|---|
| FR-101 | 로그인 SSO | DES-3.2 | auth/sso.kt | TC-201, TC-202 |

→ 1인 개발자에게는 *가벼운 버전*으로 충분. 핵심은 "**테스트가 없는 요구사항**"과 "**요구사항이 없는 코드**"를 발견하는 것.

## 4.8 Gherkin & Acceptance Criteria

BDD(Behavior-Driven Development)에서 온 acceptance criteria 표기법:

```gherkin
Feature: 로그인
  As a 등록된 사용자
  I want 이메일/비밀번호로 로그인
  So that 내 데이터에 접근

  Scenario: 정확한 자격증명으로 로그인
    Given 사용자가 가입을 완료했다
    When 올바른 이메일과 비밀번호를 입력한다
    Then 대시보드로 리다이렉트된다
    And 세션 토큰이 발급된다

  Scenario: 잘못된 비밀번호
    Given 사용자가 가입을 완료했다
    When 잘못된 비밀번호를 입력한다
    Then "자격증명이 일치하지 않습니다" 메시지가 표시된다
    And 5회 실패 시 5분간 잠금된다
```

→ 자연어와 테스트 사이의 다리. Cucumber, SpecFlow 같은 도구로 *직접 실행 가능한 명세*가 됨.

## 4.9 North Star Metric & AARRR

### North Star Metric

제품의 *건강*을 단 하나의 metric으로 표현. 모든 결정의 기준점.

좋은 NSM의 조건:
- **사용자 가치를 반영** (단순 매출 아님)
- **선행지표** (lagging이 아닌)
- **팀이 영향을 줄 수 있음**

예: Spotify는 *Time spent listening*, Airbnb는 *Nights booked*, Slack은 *Messages sent within team*.

### AARRR (Pirate Metrics, Dave McClure)

스타트업 funnel의 5단계:
- **A**cquisition — 어떻게 알았나
- **A**ctivation — 첫 가치 경험은 했나
- **R**etention — 다시 오나
- **R**eferral — 추천하나
- **R**evenue — 돈을 내나

→ 1인 개발자가 모두를 추적할 필요는 없음. *가장 약한 단계*가 어디인지 한 가지를 골라 집중.

## 4.10 Story Mapping (Jeff Patton)

→ 자세한 내용은 [`01-product-track.md`](./01-product-track.md#scope-결정-도구) 참조.

핵심 정리:
- **Backbone activities** (사용자 여정의 큰 단계)를 가로축
- 각 backbone 아래 *세부 task*를 세로로 우선순위 정렬
- *수평으로 자른 띠* = release slice (R1=MVP, R2, R3)

평면 backlog의 문제 — 우선순위만 있고 *흐름*이 없음 — 을 해결하는 도구.

## 4.11 Story Splitting Patterns

큰 user story를 어떻게 쪼개야 *독립적으로 배포 가능*한 단위가 되는가:

| 패턴 | 예시 |
|---|---|
| **Workflow steps** | "체크아웃" → "장바구니 표시" / "주소 입력" / "결제" / "확인" |
| **Business rule variations** | "할인" → "쿠폰만" → "쿠폰+포인트" → "VIP 등급별" |
| **Happy / Unhappy path** | 정상 흐름 먼저, 에러 처리는 다음 슬라이스 |
| **Data variations** | "결제수단" → "카드만" → "카카오페이" → "해외카드" |
| **Operations (CRUD)** | "Read만" → "Create" → "Update" → "Delete" |
| **Interface variations** | "데스크탑만" → "모바일웹" → "앱" |
| **Defer performance** | "동작만" → "캐시" → "최적화" |

(Richard Lawrence의 패턴 카탈로그를 단순화)

## 4.12 Lean Canvas vs Value Proposition Canvas

| | Lean Canvas | Value Proposition Canvas |
|---|---|---|
| 저자 | Ash Maurya | Strategyzer (Osterwalder) |
| 목적 | 사업모델 전체 | 가치제안 ↔ 고객 fit |
| 칸 수 | 9 | 2개 캔버스 (각 3섹션) |
| 적합 시점 | 초기 컨셉 정의 | Persona 후 가치제안 정밀화 |

→ Lean Canvas로 *전체*를 한 장에 담은 뒤, 좁힐 영역이 *가치 제안*이면 VPC를 추가로 그림.

## 4.13 Dual-Track Agile

Discovery와 Delivery를 *병행*하는 모델:

```
Discovery: [interview] → [prototype] → [validate] → ...
Delivery:     [sprint N]    [sprint N+1]    [sprint N+2]    ...
                ↑              ↑              ↑
            검증된 백로그가 흘러들어옴
```

핵심: Discovery 트랙의 *결과만* Delivery 트랙으로 흘러간다 — 미검증 아이디어는 들어가지 않음.

1인 개발자 적용: 일주일 중 *고정 시간* (예: 금요일 오전)을 Discovery에 할당. 평일 나머지는 Delivery.

## 4.14 Wardley Mapping (조금 더 깊게 가고 싶다면)

Simon Wardley의 전략 지도. 가치사슬을 *진화 단계*(genesis → custom → product → commodity)에 따라 위치시킴.

- 무엇을 *직접* 만들고 무엇을 *구매*할지 시각화
- 시간이 흐르면서 진화하는 component의 방향성 보임

→ 1인 개발자에게 즉시 필요한 도구는 아님. *플랫폼/SaaS*를 만들려고 할 때 한 번 그려보면 유용.

## 4.15 RACI (책임 모델) — 1인이지만 자기에게 적용

| 활동 | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Persona 정의 | 본인 | 본인 | 인터뷰이 5명 | 베타 사용자 |
| 아키텍처 결정 | 본인 | 본인 | (멘토/리뷰어) | 본인의 미래 자신 |

→ 1인이라도 "*나중의 내가* informed되어야 한다"를 의식하면 문서화가 자연스러워짐.

## 4.16 Acceptance vs Definition of Done (DoD)

혼동하기 쉬움:

- **Acceptance Criteria**: 이 *스토리*가 받아들여지기 위한 조건 — *기능별*로 다름
- **Definition of Done**: 모든 작업에 공통으로 적용되는 *완료 기준* — 예: "테스트 통과 + 코드 리뷰 + 문서 업데이트 + staging 배포"

→ 1인 개발자는 DoD를 *짧고 강력하게* 적어두면 자기 자신과의 합의가 됨.

## 4.17 ATAM — Architecture Tradeoff Analysis Method

SEI(Software Engineering Institute)의 아키텍처 평가 방법론. 핵심:

1. Business goals → Quality attributes (NFR과 매핑)
2. 각 quality attribute에 *시나리오* 부여 ("사용자 1만 동시 접속 시 P95 200ms")
3. 시나리오별 아키텍처 결정의 *trade-off* 평가
4. **Sensitivity points**: 결정이 quality attribute에 큰 영향
5. **Trade-off points**: 한 attribute를 올리면 다른 게 떨어지는 지점

→ 1인 개발자에게 풀버전은 과함. 핵심 *시나리오 기반 평가* 원칙만 차용해도 충분.

## 4.18 정리 — 우선 익혀야 할 5가지

다 알 필요 없다. **다음 사이클에서 적용할 5가지**만 고르면:

1. **JTBD** — Persona를 보완. *왜 고용되는가*의 시각.
2. **Opportunity Solution Tree** — 해법 다양성 강제, 가정 시각화.
3. **FURPS+** — NFR을 7가지로 점검. 누락 방지.
4. **C4 Context + Container** — 아키텍처 다이어그램 두 장.
5. **MADR** — ADR 형식 통일.

나머지는 *특정 사이클에 필요할 때*만 깊이 본다.
