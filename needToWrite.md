# 작성 필요 스킬 목록

> 기준: PM과 Developer 일상 워크플로우 기반 gap 분석 (2026-03-30)
> 우선순위: HIGH = 매일 필요 / 기존 커버 없음, MEDIUM = 주 단위 / 부분 커버, LOW = 간헐적

---

## PM 관점

| 우선순위 | 스킬명 | 설명 | 기존 스킬로 커버 안 되는 이유 |
|--------|--------|------|--------------------------|
| 🔴 HIGH | `competitive-analysis` | 경쟁사 분석, 시장 포지셔닝, 차별화 전략 | product-discovery는 고객 발견에만 집중, 경쟁 환경 전략 없음 |
| 🔴 HIGH | `go-to-market-planning` | GTM 전략, 런칭 채널, 메시지 프레이밍 | prd-development/shape-up은 "무엇을 만들까"만 다룸, "어떻게 출시할까" 없음 |
| 🔴 HIGH | `pricing-monetization-strategy` | 가격 책정, 수익 모델, 패키징 전략 | 기존 스킬 전체에 수익 관점 부재 |
| 🔴 HIGH | `stakeholder-management` | 이해관계자 설득, 갈등 관리, 신뢰 구축 | OKR/shape-up은 결정 후를 다루지만, 결정까지의 정치적 실무 없음 |
| 🟡 MEDIUM | `metrics-interpretation` | 대시보드 해석, 데이터 이상 탐지, 의사결정용 분석 | hypothesis-driven-dev는 실험 설계만, 데이터 읽기/해석 없음 |
| 🟡 MEDIUM | `feature-prioritization` | RICE/MoSCoW/Value-Risk-Effort 스코어링 | OKR은 목표 정렬, shape-up은 범위 설정 — 수백 개 후보에서 20개 고르는 방법론 없음 |
| 🟡 MEDIUM | `customer-research-synthesis` | 인터뷰 노트 → 패턴 추출 → 인사이트 도출 | product-discovery는 "고객을 만나라"지만, 70개 인터뷰에서 의미 뽑는 법 없음 |
| 🟡 MEDIUM | `roadmap-communication` | 로드맵 투명 공유, "왜 이 순서?"를 비개발자에게 설명 | roadmap-planning은 계획 생성, 설득/공유 커뮤니케이션은 별개 |
| 🟡 MEDIUM | `post-launch-retrospective` | 출시 후 평가, 학습 문서화, 가정 검증 | hypothesis-driven-dev는 실험 설계, 출시 후 구조적 회고 없음 |
| 🟡 MEDIUM | `technical-feasibility-assessment` | 기술 타당성 빠른 판단 (엔지니어 없이) | 현재 PM 스킬 전부 기술 감각 없음, 엔지니어링 의존 없이 feasibility 판단 불가 |

---

## Developer 관점

| 우선순위 | 스킬명 | 설명 | 기존 스킬로 커버 안 되는 이유 |
|--------|--------|------|--------------------------|
| 🔴 HIGH | `code-review-mastery` | PR 리뷰 작성, 건설적 피드백, 컨벤션 집행 | clean-code는 "나쁜 코드 정의"만, "어떻게 PR에서 지적하는가"는 없음 |
| 🔴 HIGH | `debugging-methodology` | 체계적 디버깅, 가설 기반 추적, 로그/프로파일러 해석 | flaky-test-analyzer는 테스트 한정, 범용 디버깅 방법론 없음 |
| 🔴 HIGH | `performance-profiling-optimization` | 병목 식별, CPU/메모리/IO 최적화 | database-optimizer/connection-pool-tuner는 너무 좁음, 범용 성능 최적화 없음 |
| 🟡 MEDIUM | `api-design` | REST/GraphQL 설계, 버전 관리, 하위 호환 전략 | 언어 스킬(spring-boot 등)은 있지만 "좋은 API란?" 체계적 가이드 없음 |
| 🟡 MEDIUM | `security-threat-modeling` | 위협 분석, 공격 벡터 식별, 보안 요구사항 정의 | test-master가 "보안 테스트 하세요"만 언급, 무엇을 어떻게 막을지 없음 |
| 🟡 MEDIUM | `legacy-code-refactoring` | 레거시 이해, 기술 부채 평가, 점진적 개선 전략 | clean-architecture/clean-code는 greenfield 설계, 기존 코드 개선 전략 없음 |
| 🟡 MEDIUM | `dependency-management` | 라이브러리 업데이트, 보안 패치, 마이그레이션 계획 | 기존 스킬 전체에 의존성 관리 관점 없음 |
| 🟡 MEDIUM | `incident-response-playbook` | 장애 탐지, 심각도 분류, RCA, 사후 조치 | sre-engineer는 신뢰성 설계, chaos-engineer는 의도적 실패 — 실제 장애 대응 없음 |
| 🟡 MEDIUM | `documentation-strategy` | 아키텍처/API/런북 문서 전략, 문서 유지 | code-documenter는 코드 주석만, 조직 수준 문서 전략 없음 |
| 🟢 LOW | `developer-productivity-optimization` | 빌드/테스트 속도, 개발환경 자동화, 반복 작업 제거 | pragmatic-programmer는 철학적 원칙만, 실무 도구/환경 최적화 없음 |

---

## 참고: 효율성 문제도 있는 기존 스킬 영역

별도 작성보다 **통폐합이 유리한 영역** (devil's advocate 분석 결과):

| 영역 | 문제 | 제안 |
|------|------|------|
| cognition 9개 + think 일부 | assumption-extractor vs first-principles, bias-auditor vs devils-advocate 중복 | 라우팅 가이드 추가 또는 통폐합 |
| PM 11개 내 모호한 경계 | shape-up vs inspired-pm, user-story vs prd 선택 기준 불명확 | product-discovery에 라우터 역할 명시 |
| develop 내 설계 스킬 순서 | architecture-designer → clean-architecture → DDD 선행조건 미명시 | 각 SKILL.md에 "이 스킬 전에 X를 완료하세요" 추가 |
