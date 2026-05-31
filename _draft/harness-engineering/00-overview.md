# 00. Harness Engineering — 개념과 전체 맵

## 0.1 사용자 정의 (원문 보존)

> 개발에 있어서 **기획**(타겟 고객(Persona) 정의 → 서비스 컨셉 정의 → 요구사항 수집 → 요구사항 정의서(RFP, SRS) → 사용자 여정 지도(User Journey Map) → MVP 범위 정의) → **검증 루프** → **기술 기획**(아키텍처 설계 → 기술 스택 선정 → DB 설계) → **검증 루프** 프로세스를 의미한다.

## 0.2 "Harness Engineering"이라는 용어

"Harness"는 본래 "마구(馬具)" — 말의 힘을 마차에 전달하기 위한 결합 장치를 뜻한다. 소프트웨어에서는 **test harness**(테스트 실행을 둘러싸는 보조 코드)나 **execution harness**(작업을 조율하는 외피)에서 쓰인다. 여기서는 그 의미를 확장해 **"개발자가 제품 아이디어를 실제 시스템으로 끌고 가는 데 필요한 단계·산출물·검증 게이트의 결합 구조"**로 정의한다.

업계 표준 용어는 아니다. 가장 가까운 외부 개념은 다음이다:

- **Double Diamond** (UK Design Council): Discover → Define → Develop → Deliver. 발산/수렴을 두 번 반복.
- **Dual-Track Agile** (Marty Cagan / Jeff Patton): Discovery 트랙과 Delivery 트랙을 병행, 각자의 산출물과 게이트.
- **Lean Startup** (Eric Ries): Build–Measure–Learn 루프. 검증으로 다음 단계를 결정.
- **Shape Up** (Basecamp): Shaping → Betting → Building. 사전에 형태를 잡고 commit.

이 하네스는 그중 **Dual-Track + Lean의 검증 루프**를 일인 개발자 관점으로 축약한 형태에 가깝다.

## 0.2b Böckeler의 "Harness Engineering"과의 관계 (namesake)

"harness"라는 단어를 *AI 코딩 맥락*에서 정립한 가장 가까운 외부 작업은 Birgitta Böckeler / Thoughtworks의 **Harness Engineering for Coding Agents** ([martinfowler.com](https://martinfowler.com/articles/harness-engineering.html))이다. 핵심 정의:

> **Agent = Model + Harness.** Harness는 *모델을 제외한 모든 주변 장치* — 에이전트를 양질의 출력으로 조종하는 가이드와 센서의 외피.

그녀의 분류 체계:

| 축 | 구분 |
|---|---|
| 제어 방향 | **Guide** (feedforward — 행동 *전* 조종) / **Sensor** (feedback — 행동 *후* 관측·자가교정) |
| 실행 모드 | **Computational** (결정론적: 린터·테스트·타입체커, ms) / **Inferential** (의미론적 AI 분석, 느리고 비결정론적, 풍부) |
| 개선 | **Steering Loop** — 이슈가 반복되면 인간이 harness를 개선 (에이전트로 harness를 짓기도) |
| 규제 범주 | **Maintainability / Architecture Fitness / Behaviour** (모두 *코드 품질*) |

### 우리의 위치 — 같은 계보, 한 층 위

우리 시나리오 자체가 *"Agent(Claude) = Model + Harness(이 프로젝트)"*다. 즉 이 하네스는 **코딩 에이전트를 *제품 개발 사이클 전체*를 통과하도록 조종하는 harness**다. Böckeler의 어휘를 그대로 빌리면:

- 13장의 *"코드로 강제 vs narrative 판단"* = 그녀의 *Computational vs Inferential* (독립적으로 수렴 — 설계의 외부 검증)
- 13장의 *black box 기록* = *Sensor (feedback)*
- pre-cycle gate·Tier A 주입 = *Guide (feedforward)*
- `findings.md` → retro → carryover = *Steering Loop*

**차별점 (이 프로젝트의 기여)**: Böckeler의 3 규제 범주는 전부 *코드 품질*이다. 우리는 **4번째 범주 — Product / Process Validation**을 추가한다: "빌드 *전에* 검증했나 · kill해야 할 때 kill했나 · 가설이 falsifiable한가 · WIP를 지켰나." 즉 harness engineering을 *코드에서 제품 프로세스로 위로 확장*한다.

이 관계가 `devils-advocate.md`의 `CV-1`(author=enforcer=target)을 정면으로 푼다 — Böckeler 曰 *"인간은 harness가 대체 못 하는 organisational alignment를 가져오되, harness가 supervision toil을 줄인다."* enforcer를 *사람에서 코드로* 옮기되 판단은 사람에게 남긴다. 이게 13장 §3 경계의 근거다.

## 0.3 두 트랙과 두 검증 루프

```
┌──────────────────────────────────────────────────────────────┐
│ PRODUCT TRACK  (왜 / 누구를 위해 / 무엇)                       │
│                                                              │
│  Persona ─→ Service Concept ─→ Requirements ─→ SRS/RFP       │
│      │                                            │          │
│      └────────────→ User Journey Map ←────────────┘          │
│                          │                                   │
│                          ▼                                   │
│                     MVP Scope                                │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
                  ╔══════════════════════╗
                  ║  VALIDATION LOOP 1   ║   ← 제품 가설 검증
                  ║  (Product hypothesis) ║      Fake-door / Wizard of Oz
                  ║                       ║      Concierge / Prototype
                  ╚══════════╤═══════════╝       Interview-driven
                             │
                       Pivot / Persevere
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ TECH TRACK  (어떻게)                                          │
│                                                              │
│   Architecture ─→ Tech Stack ─→ DB Design                    │
│        │              │            │                         │
│        └──────────────┴────────────┘                         │
│                       │                                      │
│                       ▼                                      │
│                  Design Doc + ADRs                           │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
                  ╔══════════════════════╗
                  ║  VALIDATION LOOP 2   ║   ← 기술 가설 검증
                  ║  (Tech hypothesis)   ║       Spike / POC
                  ║                      ║       Perf benchmark
                  ╚══════════╤═══════════╝       Threat model / Chaos
                             │
                             ▼
                         BUILD
```

## 0.4 두 트랙을 분리하는 이유

**제품 트랙 산출물은 "사람"을, 기술 트랙 산출물은 "시스템"을 다룬다.** 두 가지를 한 문서에 섞으면 둘 다 흐려진다. 특히 1인 개발자는 머릿속에서 두 트랙이 즉시 결합되므로, 의식적으로 분리해서 적어두지 않으면 "이 기능이 왜 필요한가"의 답을 잃은 채 코드를 짜게 된다.

분리 원칙:

| 트랙 | 1차 산출물 | 검증 대상 | 실패하면 |
|---|---|---|---|
| Product | Persona, JTBD, UJM, SRS, MVP scope | **가치/필요성** — 이게 진짜 문제인가, 이 해법이 풀리는가 | Pivot (다른 문제 / 다른 해법 / 다른 고객) |
| Tech | Design Doc, ADR, 아키텍처 다이어그램, 데이터 모델 | **실현 가능성/성능/리스크** — 기술적으로 풀 수 있는가, 운영 가능한가 | 스택 변경 / 아키텍처 단순화 / scope 축소 |

## 0.5 검증 루프를 게이트로 두는 이유

루프를 거치지 않고 다음 트랙으로 넘어가면 자주 발생하는 실패:

- **제품 검증 없이 기술로 넘어가면**: 정교한 아키텍처를 짰는데 풀어야 할 문제 자체가 잘못된 정의였음. 매몰비용으로 인해 잘못된 문제를 계속 풀게 된다.
- **기술 검증 없이 빌드로 넘어가면**: MVP가 시연 단계에서 성능/스케일/통합 문제로 무너짐. 데모 데이는 됐는데 실제로는 못 쓰는 상태.

각 루프는 "**진짜 문제인가/진짜 풀리는가**"를 **가장 싼 방법으로** 확인하는 단계지, 추가 산출물을 만드는 단계가 아니다. 인터뷰 5명, fake-door 페이지 하나, 핵심 경로 POC 하나면 충분할 때가 많다.

## 0.6 산출물 목록 (한눈에)

**제품 트랙**
- [ ] 1차 Persona (1-3명)
- [ ] Service Concept 1줄 (Lean Canvas 또는 Value Proposition Canvas)
- [ ] Requirements 원본 (인터뷰 노트, 설문, 분석 데이터)
- [ ] SRS / RFP (FR + NFR 분리)
- [ ] User Journey Map (현재 상태 + 목표 상태)
- [ ] MVP Scope (RICE 또는 MoSCoW 우선순위 + 첫 release slice)
- [ ] **검증 게이트 1**: 가설 정의서 + 검증 결과

**기술 트랙**
- [ ] Design Doc (1개 — 핵심 결정 묶음)
- [ ] ADR 시리즈 (결정 단위로 1개씩)
- [ ] 아키텍처 다이어그램 (C4 Context + Container 최소)
- [ ] 기술 스택 결정 매트릭스
- [ ] 데이터 모델 (Conceptual ER → Logical → Physical)
- [ ] NFR 명세 (성능/가용성/보안/관측성 수치)
- [ ] **검증 게이트 2**: 핵심 경로 Spike/POC 결과 + 위험 평가

## 0.7 이 하네스가 풀려고 하는 문제

1인 개발자가 자기 자신에게 "기획 단계를 건너뛰지 마"라고 강제하는 도구. 코드를 잘 짜는 사람일수록 코드 단계로 빨리 가려 한다. 이 하네스는 그 가속을 의도적으로 늦춘다 — 단, 사이클 한 번이 *몇 주가 아니라 며칠* 안에 끝나도록 설계되어야 한다. 그렇지 않으면 회피된다.
