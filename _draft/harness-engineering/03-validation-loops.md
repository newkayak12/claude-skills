# 03. Validation Loops — 검증 루프

검증의 목적은 *결정을 미루지 않는 것*. 가설을 적고, 가장 *싼 방법*으로 참/거짓을 확인하고, 그 결과에 따라 다음 트랙으로 넘어갈지 / pivot할지를 정한다.

## 3.1 두 루프의 위치

- **Loop 1 — Product Hypothesis**: 제품 트랙 끝, 기술 트랙 시작 전.
  - 검증 대상: "이게 진짜 문제인가? 이 해법이 이 사람들에게 가치를 만드는가?"
- **Loop 2 — Tech Hypothesis**: 기술 트랙 끝, 본격 빌드 시작 전.
  - 검증 대상: "기술적으로 실현 가능한가? NFR을 만족할 수 있는가? 운영 가능한가?"

## 3.2 가설 작성법 — *Falsifiable*

좋은 가설은 **반증 가능**해야 한다. "유저가 좋아할 것이다"는 가설이 아니다.

### 템플릿

> **We believe** that [persona] doing [behavior]
> will result in [outcome].
> **We'll know we're right** when we see [signal/metric ≥ threshold]
> within [time window].

### 예시

**나쁜 가설**: "우리 제품이 유용할 것이다."

**좋은 가설**: "우리는 *주말에 사이드 프로젝트를 하는 백엔드 개발자*가 *PR 리뷰 요청 페이지에서 '구조 변경만 먼저 보기' 버튼을 클릭*하면 *전체 리뷰 시간이 30% 줄어들 것*이라 믿는다. *베타 사용자 20명 중 12명 이상이 일주일에 2회 이상 이 버튼을 누른다*면 가설이 입증된 것으로 본다."

→ Threshold가 *사전에* 정해져 있어야 사후 합리화를 막을 수 있다.

## 3.3 Loop 1 — Product Validation 기법

### 비용 오름차순으로 정렬

| 기법 | 무엇 | 비용 | 검증하는 것 |
|---|---|---|---|
| Customer Interview | 5-7명에게 *과거 행동* 인터뷰 (The Mom Test) | 매우 낮음 | 문제 존재성, 우회 행동 |
| Fake Door / Smoke Test | "이런 기능이 있다"고 광고 → 클릭률 측정 | 낮음 | 표면적 관심도 |
| Landing Page Test | 가입 페이지만 만들고 가입률 측정 | 낮음 | 가치 제안의 매력도 |
| Wizard of Oz | 사용자에게는 자동화처럼 보이지만 뒤에서 사람이 처리 | 중간 | 행동 가치 (실제로 쓰는가) |
| Concierge MVP | 소수 고객에게 수동 서비스 제공 | 중간-높음 | 풀 가치 사슬 검증 |
| Prototype | clickable mockup으로 사용성 평가 | 중간 | 사용성, 흐름 이해 |

### Build–Measure–Learn — Lean Startup 루프

1. **Build**: 가설을 검증할 *최소 산출물*. 진짜 제품 아님 — fake door, mockup, concierge 등.
2. **Measure**: 사전 정의한 metric 수집. *분석 가능한 형태*로 (이벤트 로그, 인터뷰 노트).
3. **Learn**: 가설 입증/기각 판단. 다음 사이클 진입 또는 pivot.

### Pivot의 유형 (Eric Ries)

- **Zoom-in**: 기능 하나가 핵심 — 그것을 제품으로
- **Zoom-out**: 한 기능으로는 부족 — 더 큰 묶음으로
- **Customer segment**: 같은 문제, 다른 고객군
- **Customer need**: 같은 고객, 다른 문제
- **Platform**: 앱 ↔ 플랫폼 전환
- **Business architecture**: B2B ↔ B2C
- **Value capture**: 수익화 방식 변경
- **Engine of growth**: 바이럴 vs 유료 vs sticky
- **Channel**: 유통 채널 전환
- **Technology**: 같은 가치, 다른 기술 (드물게 product pivot)

### Loop 1의 산출물

- 가설 정의서 (3-5개)
- 검증 방법 + 비용 + 기간
- 결과 데이터 (수치 + 인용)
- 의사결정: 다음 트랙 진입 / pivot / 종료

## 3.4 Loop 2 — Tech Validation 기법

### 무엇을 검증하는가 — 4 Product Risks (Marty Cagan)

Cagan은 모든 제품에 4가지 리스크가 있다고 본다:
- **Value risk** (가치): 사용자가 이걸 살 것인가? → Loop 1에서 검증
- **Usability risk** (사용성): 사용자가 쓸 수 있는가? → Loop 1에서 prototype으로
- **Feasibility risk** (실현가능성): 우리가 만들 수 있는가? → **Loop 2의 핵심**
- **Viability risk** (사업성): 우리 비즈니스가 견딜 수 있는가? → Loop 2에서 운영비/규제 측면

### Loop 2 기법

| 기법 | 무엇 | 검증하는 것 |
|---|---|---|
| **Spike** | 시간 박스 (1-3일) 안의 탐색 코드 | "이 기술로 이게 되긴 되나?" |
| **POC (Proof of Concept)** | 핵심 경로 1개의 end-to-end 동작 | feasibility 전반 |
| **Prototype** (tech prototype) | 실제와 비슷한 환경에서 동작 | 통합·운영성 |
| **Performance benchmark** | 부하 시나리오 정의 + 측정 | NFR 충족 여부 |
| **Threat model** (STRIDE) | 보안 위협 시나리오별 점검 | 보안 리스크 |
| **Chaos test** | 의도적 장애 주입 | 회복성·운영 가능성 |
| **Architecture review** | 동료/외부 리뷰어 피드백 | 맹점 보완 |

### STRIDE — Threat Modeling

Microsoft의 위협 분류:
- **Spoofing** (위장)
- **Tampering** (변조)
- **Repudiation** (부인)
- **Information disclosure** (정보 유출)
- **Denial of service** (서비스 거부)
- **Elevation of privilege** (권한 상승)

각 컴포넌트 / 데이터 흐름 / trust boundary마다 STRIDE 6개를 점검. 1인 개발자라도 **인증 경계와 데이터 저장 경계**는 반드시 짚어야 함.

### Spike vs POC — 차이

- **Spike**: *알아보기* 위한 코드. 버려진다. "Redis Streams가 우리 use case에 맞나?"
- **POC**: *증명*하기 위한 코드. 핵심 경로가 도는 것을 보여줌. "사용자 1만 명 동시 접속에서 P95 200ms 가능?"

Spike의 결과는 ADR로 들어가야 한다 — 그래야 *왜 그 기술을 안 골랐는가*가 기록됨.

### 위험 평가 — Risk Register

| ID | 리스크 | 가능성 | 영향 | 대응 (Avoid/Reduce/Transfer/Accept) | 트리거 |
|---|---|---|---|---|---|
| R1 | DB 쓰기 폭주 시 락 | M | H | Reduce: 비동기 큐 도입 | 동시 사용자 1k 도달 |
| R2 | 외부 API rate limit | H | M | Accept: 캐시·재시도 | 첫 베타 |

→ Top 5 리스크는 *대응 행동이 명시*되어야 함. 행동이 없으면 그건 리스크가 아니라 걱정이다.

### Loop 2의 산출물

- 기술 가설 정의서 (3-5개)
- Spike/POC 결과 (코드 + 측정치)
- NFR benchmark 결과
- Threat model 결과
- Risk register
- 의사결정: 빌드 진행 / 아키텍처 조정 / 스택 변경 / scope 축소

## 3.5 루프를 짧게 유지하는 법

**증상**: 검증 루프가 *몇 주*로 늘어진다 → 회피된다.

**대책**:
- **Time-box**: 각 루프는 *기한 명시*. 7-14일이 보통. 결과가 부족해도 그 시점에서 결론 내림.
- **Hypothesis는 *최대 5개*** — 더 많아지면 우선순위가 흐려짐.
- **검증 방법의 비용을 보수적으로 추정** — 인터뷰 5명도 *섭외 + 진행 + 정리*로 보통 2주 소요.
- **결과 *없음*도 결론**: "데이터 부족"이 결론이면 다음 사이클의 첫 액션은 *데이터 수집 자체*가 됨.

## 3.6 검증 게이트 통과 기준 (자기점검)

다음 트랙으로 넘어가기 전에 다음 4가지를 *글로* 답할 수 있어야 한다:

1. **검증된 것**: 어떤 가설이 *증거로* 입증되었는가? (수치 + 인용)
2. **기각된 것**: 어떤 가설이 *기각*되었는가? 무엇이 바뀌어야 했는가?
3. **미해결**: 검증 못한 가설은 무엇이고, *왜 미루기로 했는가*? (위험 수용 기록)
4. **다음 사이클의 가장 큰 리스크**: 그래서 무엇이 다음에 가장 위험한가?
