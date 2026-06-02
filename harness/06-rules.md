# 06. Rules — 항상 적용되는 룰 (단계별 선택 로딩)

이 문서는 하네스가 *항상* 의존하는 룰을 한 곳에 모은 카탈로그다. 모든 룰을 모든 단계에서 동시에 적용할 필요는 없다 — 각 룰에 붙은 **`Stage` 태그**를 보고 해당 단계에 진입할 때 *꺼내 쓴다*.

상황별로만 등장하는 룰(보안·데이터·운영·사고·자기통제 baseline)은 [`situational-rules/`](./situational-rules/)에 별도로 정리.

## 0. 어떻게 읽는가

각 룰의 표기:

- **ID**: `R-CCNN` (CC = 카테고리 약자, NN = 일련번호)
- **Stage**: 적용 시점
- **Rule**: 한 줄 명령형
- **Why**: 안 지키면 무엇이 무너지나
- **How to apply**: 실전에서의 적용 방식

## 0.1 Stage 목록 (selective loading 키)

| Stage 키 | 의미 |
|---|---|
| `cycle-start` | 사이클 시작 (제품 트랙 진입 직전) |
| `product-track` | 제품 트랙 진행 중 |
| `mvp-scope` | MVP 범위 정의 단계 |
| `gate-1` | 검증 게이트 1 (제품 가설) |
| `tech-track` | 기술 트랙 진입 |
| `architecture` | 아키텍처 설계 단계 |
| `decision` | 주요 결정 직전 (스택·DB·API 등) |
| `code-writing` | 코드 작성 단계 |
| `gate-2` | 검증 게이트 2 (기술 가설) |
| `task-done` | 작업 완료 판정 시 |
| `cycle-end` | 사이클 종료 (회고) |
| `always` | 사이클 내내 |

---

## 1. 코드·설계 원칙

**로딩 시점**: `code-writing`

### R-CD01: SOLID를 머릿속에 두고 코드를 짠다
- **Why**: 변경 비용을 낮추는 5개 원칙. 적용 못 해도 *어긴 것은 인지*해야 함.
- **How**: SRP(단일책임), OCP(확장 개방·수정 폐쇄), LSP(리스코프 치환), ISP(인터페이스 분리), DIP(의존성 역전). 코드 리뷰 시 5개를 1차 점검.

### R-CD02: KISS — 단순함이 기본값
- **Why**: 복잡도는 들어오기 쉽고 나가기 어렵다. 단순한 해법이 *항상* 첫 후보.
- **How**: 두 해법이 동등하면 행 수·의존성·개념 수가 적은 쪽.

### R-CD03: YAGNI — 가설적 미래에 코드 짜지 않는다
- **Why**: 안 쓰일 기능이 미래의 변경을 막는다. 추측은 *문서*로 남기되 *코드*로 넣지 않음.
- **How**: "지금 검증된 요구"에 한정. 미래 확장은 ADR에만.

### R-CD04: DRY는 *Rule of Three*까지 기다린다
- **Why**: 2번 반복으로 추상화하면 *잘못된* 추상이 박힌다 — WET(write everything twice)가 종종 더 안전.
- **How**: 같은 의도·도메인의 3번째 등장 시 추상화 검토.

### R-CD05: Composition over Inheritance
- **Why**: 상속은 강결합. 동작 차이를 *전략·정책 객체*로 표현하는 게 일반적으로 더 유연.
- **How**: 새 동작 추가 욕구가 생기면 *상속 트리 키우기 전*에 composition 가능성 점검.

### R-CD06: Tell, Don't Ask / Law of Demeter
- **Why**: 객체 내부 상태를 묻고 외부에서 분기하면 캡슐화가 무너짐.
- **How**: `a.b().c().d()` 패턴이 보이면 위임 메서드를 만들지 검토. 단, *Value Object 체인*은 예외.

### R-CD07: Boy Scout Rule
- **Why**: 만진 코드는 *조금 더 깨끗하게*. 합치면 부채가 줄어든다.
- **How**: 변경 범위의 *이름·중복·죽은 코드*를 그 PR에서 같이 정리. **무관한 대형 리팩토링은 금지**.

---

## 2. 아키텍처 원칙

**로딩 시점**: `architecture`, `tech-track`

### R-AR01: Separation of Concerns
- **Why**: 한 모듈이 여러 관심을 섞으면 변경 한 가지에 모듈 전체가 흔들린다.
- **How**: 모듈 정의 시 "이 모듈이 *바뀌는 이유*"를 한 문장으로 적을 수 있어야 함.

### R-AR02: Single Source of Truth
- **Why**: 같은 사실을 두 곳에 저장하면 *정합성 부채*가 누적됨.
- **How**: 핵심 엔티티마다 *주인 시스템* 명시. 다른 곳은 *복제본*이며 *어떻게 동기화*되는지 ADR에.

### R-AR03: Fail Fast, Fail Loud
- **Why**: 조용한 실패는 *발견을 미루는* 부채. 운영 들어가면 디버그 불가능.
- **How**: 잘못된 입력·상태는 *경계*에서 즉시 reject + 구조화 에러 로그. swallow exception 금지.

### R-AR04: Idempotency by Default at System Boundaries
- **Why**: 분산·재시도·중복 호출은 *언젠가* 발생. 멱등하지 않으면 데이터가 오염됨.
- **How**: 외부에서 들어오는 mutating 요청은 idempotency key 받기. 내부 메시지도 *최소 1회 vs 정확히 1회* 명시.

### R-AR05: 12-Factor App 준수
- **Why**: 컨테이너·클라우드 환경의 *최소 호환성*. 12개 항목 위반 = 운영 부담.
- **How**: 12개를 체크리스트로 점검 (Codebase, Dependencies, Config, Backing Services, Build/Release/Run, Processes, Port Binding, Concurrency, Disposability, Dev/Prod Parity, Logs, Admin Processes).

### R-AR06: One-way vs Two-way Door 결정 분리
- **Why**: 되돌릴 수 있는 결정(two-way)은 빨리, 되돌릴 수 없는 결정(one-way)은 느리고 깊게. 둘을 같이 처리하면 빠른 결정도 무거워지고 무거운 결정도 가벼워짐.
- **How**: 각 결정에 *Reversibility* 등급 부여. one-way는 ADR + devil's advocate 강제.

---

## 3. 프로세스 게이트 (필수)

**로딩 시점**: `always` — 사이클 전체에서 강제

### R-PG01: No code before design
- **Why**: 디자인 단계의 글이 안 써진다면 머릿속도 안 정리된 것. 코드부터 짜면 *틀린 문제*를 푸는 데 시간을 쏟음.
- **How**: 브레인스토밍 + Design Doc/ADR 통과 전 코드 금지. 예외: 1-3일 spike (그 결과는 *코드가 아니라 ADR*로 흘러감).

### R-PG02: No build before validation
- **Why**: 미검증 가설로 빌드에 들어가면, 데모 후 *처음부터* 다시 해야 할 위험.
- **How**: 검증 게이트 1을 통과해야 기술 트랙 진입. 게이트 2를 통과해야 본격 빌드.

### R-PG03: Small atomic commits
- **Why**: 큰 커밋은 리뷰 불가능, 롤백 불가능. *한 커밋 = 한 의도*.
- **How**: 커밋 메시지를 *완전한 문장*으로 적을 수 있을 정도로 작게. 한 PR에 무관한 변경 금지.

### R-PG04: Branch / Merge 정책 명시
- **Why**: 정책이 없으면 매번 즉흥 결정. PR 사이즈·머지 방식·릴리즈 컷오프가 흔들림.
- **How**: 한 줄로 정한다. 예: "trunk-based, feature는 ≤3일 short-lived branch, squash merge, semantic version."

### R-PG05: Skip는 사유를 글로 남긴다
- **Why**: 단계 건너뛰는 것 자체는 OK — 다만 *왜 건너뛰는지*가 없으면 다음 사이클에 같은 자리에서 또 사고남.
- **How**: 사이클 노트에 "Skipped: [단계명] — Reason: [이유] — Risk accepted: [무엇]" 한 줄.

---

## 4. Definition of Done (필수)

**로딩 시점**: `task-done`

> **트림됨**: Performance budget / Observability는 핵심 운영 영역으로 분리해 [`situational-rules/operations.md`](./situational-rules/operations.md)로 이동.

### R-DoD01: 테스트 통과 + 커버리지 임계 충족
- **Why**: 테스트 없는 "완료"는 *주장*일 뿐.
- **How**: 사이클 시작 시 커버리지 목표를 *수치*로 정해두기 (라인/브랜치). CI에서 실패하면 머지 차단.

### R-DoD02: Lint / Type-check 통과
- **Why**: 정적 검사는 무료의 1차 리뷰어. 통과 안 한 코드는 *읽지 않는다*.
- **How**: pre-commit hook + CI. 무시(disable)는 *주석으로 사유 명시*.

### R-DoD03: 핵심 경로 manual verify
- **Why**: 테스트가 *코드의 정확성*을 검증하더라도 *기능의 동작*은 별개. 자동 테스트가 통과해도 사람이 한 번 돌려야 함.
- **How**: 핵심 user story의 happy path + 1-2 unhappy를 손으로 돌리고, 결과를 PR 본문에 기록.

### R-DoD04: 문서 업데이트 (Design Doc / ADR / README)
- **Why**: 코드 변경과 문서가 분리되면 문서는 *반드시* 거짓말이 됨.
- **How**: 영향을 받는 Design Doc 섹션·ADR·README를 *같은 PR*에서 갱신. 안 하면 머지 거절.

---

## 5. 결정·문서 규율 (필수)

**로딩 시점**: `decision`, `architecture`, `tech-track`

### R-DD01: ADR for every significant decision
- **Why**: 안 적은 결정은 *결정하지 않은 것*. 다음 사이클에 같은 토론을 처음부터 다시 함.
- **How**: 다음 중 하나라도 해당하면 ADR 작성 — 락인 발생 / 비용 영향 / 보안 함의 / 외부 인터페이스 / 데이터 모델 변경.

### R-DD02: MADR 형식 통일
- **Why**: 형식이 다르면 *찾기*가 안 됨. 6개월 뒤 자신이 헤맴.
- **How**: 템플릿 [`templates/adr.md`](./templates/adr.md) 그대로 사용. Considered Options 최소 3개.

### R-DD03: Accepted 이후 immutable
- **Why**: 결정 자체가 *역사*. 사후 편집하면 *왜 그 시점에 그렇게 결정했나*가 사라짐.
- **How**: 변경하려면 **새 ADR**로. 옛 ADR은 `Superseded by ADR-XXXX`로 표시, 본문 유지.

### R-DD04: Design Doc per major feature
- **Why**: 핵심 결정 묶음이 한 곳에 없으면, 시스템 그림을 *머릿속에서만* 그리게 됨.
- **How**: 주요 기능마다 Design Doc 1장. 작은 변경은 ADR로 충분. 템플릿: [`templates/design-doc.md`](./templates/design-doc.md).

### R-DD05: Living docs — monthly staleness 검사
- **Why**: 한 번 쓰고 안 보는 문서는 *거짓말 매체*가 됨.
- **How**: 매월 1일 — 핵심 문서 5개 골라 *마지막 갱신 vs 마지막 코드 변경* 차이 점검. 1개월 이상 갭이면 staleness 의심.

---

## 11. 지식 보존

**로딩 시점**: `cycle-end`, `always`

### R-KP01: Retro after every cycle
- **Why**: 회고 없는 사이클은 *학습 못한 사이클*. 같은 실수가 반복됨.
- **How**: 사이클 종료 시 `think:retrospective` 자동 호출. *놀란 것* / *불편했던 것* / *다음에 바꿀 것* 3가지 항목.

### R-KP02: Ubiquitous Language / Glossary 유지
- **Why**: 도메인 용어가 흔들리면 코드·문서·대화가 모두 *조금씩 다른 의미*가 됨.
- **How**: 새 도메인 용어 등장 시 Glossary 1줄 추가. 코드·문서·UI 표기를 *같은 용어*로 통일.

### R-KP03: TIL / Learning notes
- **Why**: 인터뷰·spike·incident에서 *놀란 것*은 사이클 끝나면 잊힌다.
- **How**: 사이클 중 발견한 *반직관적 사실*을 1-2줄로 노트. 별도 파일 또는 사이클 폴더 안.

### R-KP04: Future-me as audience
- **Why**: 1인 개발자에게 *가장 자주 협업하는 동료*는 6개월 뒤의 자신.
- **How**: 문서·커밋 메시지·코드 주석을 *미래의 자신*이 컨텍스트 없이 읽는다고 가정하고 적음.

---

## 12. 스코프 규율

**로딩 시점**: `mvp-scope`, `product-track`

### R-SC01: MoSCoW Won't list 명시
- **Why**: *안 할 것*을 적지 않으면 *모두 할 것*처럼 보임. Scope creep의 일등 원인.
- **How**: MVP 정의 시 Won't 카테고리에 최소 5개 — *그 이상* 적으면 더 좋음.

### R-SC02: Scope hammering, not appetite stretching (Shape Up)
- **Why**: 시간을 늘리면 매번 더 늘게 됨. 시간은 고정, 범위를 깎는다.
- **How**: 기간이 짧을 때 첫 반응이 "더 시간 달라"가 아니라 "무엇을 뺄까?". 모든 기능을 *축소된 버전*으로 상상해보기.

### R-SC03: Appetite-based, not estimate-based
- **Why**: "얼마나 걸릴까?"는 모름. "얼마나 쓸 가치가 있나?"는 답할 수 있음.
- **How**: 시작 시 *예산*(시간)을 정함. 그 안에 들어가는 형태로 scope 결정.

### R-SC04: Beta 사용자 수 의도적 제한
- **Why**: 너무 많은 베타 사용자 = 피드백 노이즈 + 운영 부담 + scope 확장 압력.
- **How**: 첫 release는 *극소수* (5-20명). 학습이 끝나면 확장.

---

## 13. 기술 부채 관리

**로딩 시점**: `tech-track`, `cycle-end`

### R-TD01: Debt register — 의식적으로 목록화
- **Why**: 무의식 누적은 어느 날 *동시 폭발*. 의식 누적은 *제어 가능*.
- **How**: `_draft/debt.md` 또는 GH issue label로 트래킹. 항목당: *무엇·왜 받아들임·트리거(언제 갚을지)*.

### R-TD02: Conscious accept vs unconscious accumulate
- **Why**: "이번엔 빨리 가자"의 *왜*와 *비용*을 적지 않으면 다음 의사결정자(미래의 자신)가 이해 못함.
- **How**: 부채 받아들이는 PR은 본문에 "Tech debt accepted: [무엇] / Reason: [이유] / Trigger: [재검토 조건]" 명시.

### R-TD03: Pay-down ratio per cycle
- **Why**: 부채 갚는 시간을 *명시적으로 할당*하지 않으면 영영 안 갚게 됨.
- **How**: 사이클 capacity의 일부(예: 15-20%)를 부채 상환에 고정 할당. 사이클 시작 시 *어떤 항목*을 갚을지 선정.

### R-TD04: Trigger-based 재검토
- **Why**: 부채는 *상황 변화*가 트리거. 시간이 아니라 *사건*이 발생할 때 검토.
- **How**: 각 부채 항목의 트리거를 등록 (예: "DAU 10k 도달 시", "외부 의존이 deprecated 될 때"). 트리거 발화 시 자동 재검토.

---

## 14. AI / Skill 호출 규율 (필수)

**로딩 시점**: `always`

### R-AI01: 단계 진입 시 *정해진 entry skill* 자동 호출
- **Why**: 매 단계 즉흥적으로 skill을 떠올리면 누락됨. *루틴화*가 핵심.
- **How**: 단계별 entry skill은 [`05-plugin-mapping.md`](./05-plugin-mapping.md)에 명시. 단계 진입 시 *해당 skill을 먼저 호출*.

### R-AI02: 결정 직전에는 `think` 계열 호출
- **Why**: 결정 순간이 가장 흔히 *확증편향*에 빠지는 시점. 외부(skill)의 검증이 필요.
- **How**: 큰 결정(아키텍처·스택·DB·API) 직전에 `think:decision-maker` 또는 `think:devils-advocate`. 한 옵션에 강하게 끌리면 `cognition:bias-auditor`.

### R-AI03: Skill 출력은 *시작점*, 검증은 자기 책임
- **Why**: AI 출력은 *그럴듯함*이 *옳음*과 무관. 본인 sign-off 없으면 책임이 흩어짐.
- **How**: skill이 만든 ADR·Design Doc·코드는 *본인 이름으로* 채택. 핵심 결정은 *본인의 글*로 다시 적어 확인.

### R-AI04: Override는 *이유를 기록*
- **Why**: skill의 권고를 따르지 않는 건 *완벽히 정당*. 다만 그 이유를 안 적으면 *나중에 같은 토론*을 반복.
- **How**: skill 권고를 무시할 때는 ADR 본문 또는 사이클 노트에 "Skill suggested X, chose Y because Z" 한 줄.

### R-AI05: 한 사이클에 5개 이상의 skill 호출은 의심
- **Why**: skill 호출이 늘어나면 *의사결정 마비*. 우선순위가 흐려지는 신호.
- **How**: 사이클 노트에서 호출한 skill 카운트. 5개 초과 시 *어느 단계가 과도한지* 점검.

### R-AI06: Skill 출력의 *전부*를 받아들이지 않는다
- **Why**: skill은 발산을 잘하지만, *해당 프로젝트의 컨텍스트*는 못 가짐. 일반화된 권고가 섞여 들어옴.
- **How**: skill 출력에서 *프로젝트에 맞지 않는 항목*은 제거하고 채택. 트림된 흔적도 기록.

---

## Appendix A — Stage → Rule Index (Selective Loading 표)

각 단계 진입 시 *이 룰들만 꺼내 본다*. 매번 전체를 다 읽지 않는다.

### `cycle-start`
- R-AI01 — 단계별 entry skill 매핑 확인

### `product-track`
- R-SC03 — appetite-based
- R-KP02 — Glossary 갱신
- R-AI01 — Entry skill 호출

### `mvp-scope`
- R-SC01 — Won't list
- R-SC02 — Scope hammering
- R-SC03 — Appetite-based
- R-SC04 — Beta 사용자 제한

### `gate-1`
- R-PG02 — 검증 통과 전 다음 단계 금지
- R-AI02 — `think:devils-advocate` 호출

### `tech-track`, `architecture`
- R-AR01 ~ R-AR06 — 아키텍처 원칙 전부
- R-DD01 ~ R-DD05 — 결정·문서 규율 전부
- R-TD01 — Debt register 열기
- R-AI01, R-AI02

### `decision`
- R-AR06 — Reversibility
- R-DD01 ~ R-DD03 — ADR 작성
- R-AI02 — `decision-maker` / `devils-advocate`

### `code-writing`
- R-CD01 ~ R-CD07 — 코드·설계 원칙 전부
- R-PG03 — Small atomic commits
- R-DoD01 ~ R-DoD04 — DoD 점검

### `gate-2`
- R-PG02 — 검증 통과 전 빌드 금지
- R-AI02

### `task-done`
- R-DoD01 ~ R-DoD04 — DoD 전체
- R-DD05 — 문서 staleness 점검

### `cycle-end`
- R-KP01 — Retro 호출
- R-KP03 — TIL 정리
- R-TD03 — Pay-down 후속 결정
- R-AI05 — Skill 호출 카운트 점검

### `always` (사이클 내내)
- R-PG01 ~ R-PG05 — 프로세스 게이트 전부
- R-AI01, R-AI03, R-AI04, R-AI06

---

## Appendix B — 룰을 어길 때

룰을 어기는 것은 *허용*된다. 다만 다음을 적는다:

```
Rule violated: [R-XXNN]
Stage: [언제]
Reason: [왜 어겼나]
Risk accepted: [어떤 위험을 받아들이나]
Re-evaluation trigger: [언제 다시 점검할까]
```

→ 이 기록 자체가 *부채 register*의 한 줄이 된다.

---

## Appendix C — Situational Rules (별도 참조)

다음 영역은 사이클 내내 적용되지는 않지만, *해당 상황 발생 시* 반드시 참조해야 한다. 별도 문서로 분리되어 있다.

| 영역 | 참조 시점 | 파일 |
|---|---|---|
| **보안 baseline** | 인증·권한·PII 다룰 때 | [`situational-rules/security.md`](./situational-rules/security.md) |
| **데이터 규율** | DB 스키마·마이그레이션·백업 다룰 때 | [`situational-rules/data.md`](./situational-rules/data.md) |
| **운영·관측 baseline** | 출시 전 + 운영 중 (perf budget, three pillars 포함) | [`situational-rules/operations.md`](./situational-rules/operations.md) |
| **사고 규율** | 결정 마비·강한 끌림·중대한 베팅 시점 | [`situational-rules/cognitive.md`](./situational-rules/cognitive.md) |
| **자기 통제** | 사이클이 늘어지거나 WIP가 늘 때 | [`situational-rules/self-discipline.md`](./situational-rules/self-discipline.md) |
