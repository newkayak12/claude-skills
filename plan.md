# Hook 설계 개선 계획

## 검토 대상 제안

`architecture-designer` 스킬에:
1. **Step 0 조건부 분기 훅** — TRIVIAL / STANDARD / COMPLEX 분류 후 경로 분기
2. **단계별 MCP 조건부 발동 훅** — mcp-reasoner, sequential-thinking, task-manager, memory를 복잡도·단계 조건으로 발동

---

## Devil's Advocate: 핵심 반론

### 반론 1: 분류 자체가 닭-달걀 문제다

Step 0에서 TRIVIAL/COMPLEX를 판단하려면 문제를 깊이 이해해야 한다. 그런데 문제를 깊이 이해하는 것 자체가 Step 1(요구사항 수집)의 역할이다. 결국 Step 0는 증거를 수집하기 전에 판결을 내리는 구조다. 키워드("MSA", "아키텍처")나 파일 수라는 표면 신호로 복잡도를 판단하면, 아키텍처 의사결정에서 가장 흔한 실패 패턴인 **조기 종결(premature closure)** 을 오히려 스킬 자체에 내재화하는 역설이 생긴다.

### 반론 2: TRIVIAL 경로가 가장 위험한 요청을 솎아낸다

3단계 축약 경로는 "단순해 보이는 요청"에 적용된다. 그런데 아키텍처적으로 가장 위험한 결정은 단순해 보이는 것들이다. "단일 파일에 필드 하나 추가"가 DB 스키마 변경, 하위 서비스 계약 파기, 데이터 마이그레이션을 수반할 수 있다. TRIVIAL 경로는 바로 이 결정을 가장 얕게 처리하도록 설계되어 있다. 스킬이 사용자에게 "이건 간단하니 빠른 답이 맞다"는 잘못된 안전감을 심어주는 구조다.

### 반론 3: MCP 도구명 하드코딩은 보이지 않는 유지보수 부채다

`mcp-reasoner`, `sequential-thinking`, `task-manager`를 스킬 분기 로직에 직접 명시하면, 이 도구들이 없는 환경에서 스킬이 **조용히 실패**한다. 현재 `architecture-designer`는 `think-tool`을 조건부로 활용하되 fallback 없이도 작동하는 구조인데, 제안은 이 패턴을 버리고 특정 MCP 이름에 의존하는 분기를 만든다. MCP 도구의 이름이나 인터페이스가 바뀌면 스킬 로직이 stale해지지만 아무도 알아채지 못한다.

---

## 핵심 취약점

**속도 최적화(TRIVIAL → skip)와 도구 정교화(COMPLEX → MCP)가 동시에 실패하는 지점이 존재한다.**

가장 위험한 요청은 "TRIVIAL처럼 보이지만 사실은 COMPLEX"인 것들이다. 제안의 구조는 이것을 잡을 메커니즘이 없다. Step 0 분류가 TRIVIAL로 판정하면, MCP 강화는 발동조차 하지 않는다. 오분류 비용이 가장 높은 케이스를 가장 적게 보호하는 역설적 구조다.

---

## 개선 계획

### 원칙 변경

| 현재 제안 | 개선 방향 |
|-----------|-----------|
| Step 0에서 분류 | **Step 1 이후**에 분류 (요구사항 파악 후) |
| TRIVIAL 경로 → 3단계 축약 | "가속 경로" — 단계는 유지, 깊이를 조정 |
| MCP 조건부 분기 (없으면 skip) | MCP 가산적(additive) — think-tool이 base, MCP는 enhancement |
| 항상 memory 저장 | **비가역적 결정이 내려진 경우에만** 저장 |

### 수정된 구조

```
[Step 1] 요구사항 수집 (변경 없음)
    ↓
[Step 1.5] 복잡도 분류 — 이 시점에서만 분류 가능
    · 분류 기준:
      - 영향 범위: 단일 모듈 내 / 멀티 모듈 / 시스템 간
      - 결정 비가역성: 되돌릴 수 있는가
      - 미지 영역: 팀이 이 패턴을 써본 적 있는가
    · TRIVIAL: 영향 범위 단일 모듈 + 가역적 결정
    · STANDARD: 나머지 대부분
    · COMPLEX: 멀티 시스템 + 비가역적 + 새 패턴

[Step 2-5] 복잡도별 깊이 조정
    · TRIVIAL: 각 단계를 concise하게, 단 skip하지 않음
    · STANDARD: 현행 5단계 그대로
    · COMPLEX: 5단계 + MCP enhancement

[MCP 연동] 가산적 구조
    · think-tool: 항상 사용 (base reasoning)
    · mcp-reasoner: COMPLEX + 2개 이상 패턴 후보 시, 없으면 think-tool로 대체
    · sequential-thinking: COMPLEX + 검증 단계, 없으면 think-tool로 대체
    · memory 저장: ADR 결정이 완료된 경우에만, 저장 대상 = 결정 + 이유

[STANDARD는 MCP 없이도 충분]
```

### 구현 시 체크리스트

- [ ] Step 1.5 분류 기준을 SKILL.md에 표로 명시 (키워드 아닌 영향 범위·비가역성 기준)
- [ ] 각 복잡도별 "깊이 조정" 지침 작성 (skip이 아닌 density 조정)
- [ ] MCP fallback 명시: "available하면 사용, 없으면 think-tool"
- [ ] memory 저장 조건 명시: "비가역적 결정 + ADR 작성 완료 시"
- [ ] STANDARD 경로 구체화 (현재 완전히 미정의)
- [ ] 기존 architecture-designer 5단계와의 매핑 정리

---

## 질문 정리

### Q1: 다른 COMPLEX 스킬로 확장할 것인가?

**결론: architecture-designer로 먼저 검증, 이후 선택적 확장**

확장 대상 후보 (복잡도 분산이 실제로 큰 스킬들):
- `microservices-architect` — 서비스 경계 설계: 단일 서비스 추가(TRIVIAL) vs. 전체 경계 재설계(COMPLEX)
- `event-storming` — 이벤트 도출 규모에 따라 분기 의미 있음

확장 불필요:
- `clean-code`, `clean-architecture`, `domain-driven-design` — 항상 STANDARD급, 분기 이점 없음

**실행 순서**: architecture-designer 적용 → 실사용 후 효과 확인 → microservices-architect 적용

### Q2: 복잡도 분류를 사용자에게 보여줄 것인가?

**결론: 투명하게, 단 한 줄로**

- 내부 처리(silent): 오분류 시 사용자가 수정 불가. 잘못된 경로를 탔다는 것 자체를 모름
- 완전 투명: 노이즈 증가, 반복 확인 시 답답함

**채택 형식**: 요구사항 수집 직후(Step 1.5)에 한 줄 노출
```
복잡도 분류: STANDARD (이의 있으면 알려주세요)
```
이유: 사용자가 "아니, 이건 COMPLEX야"라고 한 마디로 수정 가능. 확인이 목적이 아닌 교정 기회 제공.

### 반론 3 (MCP 가용성): 기각

remote-sse 환경에서 MCP 도구 가용성이 보장되므로 fallback 설계 불필요.
체크리스트의 "MCP fallback 명시" 항목은 제거.

---

## 후속 개선 과제 (13개 스킬 devil's advocate 검증 결과, 2026-03-30)

### 반론 1: PM 스킬 chain 의존성 — 단독 실행 가능성 보완 필요
각 스킬에 "Standalone Execution" 섹션 추가 필요.
- 앞선 스킬 output이 없을 때 대체 입력 방법 제공
- e.g. pricing-monetization-strategy: "customer-research-synthesis 없으면 → 직접 WTP 인터뷰 5문항 제공"
- 대상: competitive-analysis, go-to-market-planning, pricing-monetization-strategy, technical-feasibility-assessment

### 핵심 취약점: 에이전트 실행 가능성 명시
스킬이 "에이전트가 직접 수행하는 작업"과 "사람이 수행해야 하는 작업"을 구분하지 않음.
각 스킬에 "What Claude Does / What You Do" 섹션 추가 권장.
- Claude가 생성: 분석 템플릿, 스코어링, 문서 초안, 프레임워크 적용
- 사람이 수행: 실제 인터뷰, 경쟁사 trial 가입, 시장 조사
