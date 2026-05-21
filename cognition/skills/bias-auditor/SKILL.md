---
name: bias-auditor
description: >-
  Use when evaluating a person or making a decision with high confidence —
  audits judgment / attribution / metacognition layers and prescribes per-bias
  remedies. Triggers on: "편향 점검", "내 판단 비뚤어진 것 같아", "audit my reasoning",
  "bias check", "확신이 과한 것 같아".
scenarios:
  - "Am I being biased in how I see this situation?"
  - "Why do I keep jumping to this conclusion?"
  - "Audit my reasoning for blind spots"
  - "내 판단에 편향이 있는지 봐줘"
  - "왜 나는 이 사람을 이렇게 평가하게 됐을까?"
  - "내가 너무 확신하는 것 같아, 점검해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 세 가지 편향 레이어(판단·귀인·메타인지)를 순서대로 스캔하고
    핵심 편향을 정밀하게 식별할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - fallacy-detector
  - epistemic-reasoner
  - assumption-extractor
  - devils-advocate
---

# Bias Auditor

편향을 **이름 붙이는 것**으로 끝내지 않는다. 어떤 편향이, 왜 지금 작동하고, 무엇을 해야 보정되는지를 같이 본다. v2 강화: 상황 트리거 probe, 편향별 debiasing remedy, calibration self-check.

## When to Use / When Not to Use

**Use when:**
- 사람을 평가하는데 framing이 상황(situation)보다 성격(disposition)에 치우쳐 있다
- 의사결정 confidence가 비정상적으로 높다
- "이 일이 왜 일어났는가"에 단일하고 깔끔한 서사가 지배적이다
- 시간 압박/투자 매몰/최근 사건/피로 같은 편향 유발 조건이 있다

**Not for:**
- 논증 구조 결함 → `fallacy-detector`
- 증거 대비 confidence 정량 보정 → `epistemic-reasoner`
- 명시되지 않은 전제 발굴 → `assumption-extractor` 또는 `problem-reframer`

## Process

### Step 1 — Gather the Judgment

판단·신념·평가를 가능한 한 구체적으로 받는다. "그 사람이 별로다"가 아니라 "그 사람이 회의에서 X를 하기 때문에 신뢰할 수 없다고 본다" 수준까지.

### Step 2 — Probe the Bias-Inducing Context (NEW)

편향은 진공에서 안 생긴다. 다음 트리거가 켜져 있는지 확인:

| 트리거 | 자주 같이 오는 편향 |
|---|---|
| 시간 압박 | 가용성, 앵커링, 확증편향 |
| 사전 투자/매몰비용 존재 | sunk cost, 자기합리화 |
| 최근 강렬한 사건 | 가용성, 최신성 편향 |
| 결과가 이미 보임 | hindsight bias, 사후합리화 |
| 본인과 무관한 타인 평가 | 근본 귀인 오류, actor-observer 비대칭 |
| 본인 성공/실패 설명 | self-serving attribution |
| 피로/스트레스 | 시스템 1 편중, 노력 회피 |
| 사회적 압력/합의 분위기 | groupthink, 동조 |

켜진 트리거를 먼저 적어둔다 — Step 3-5에서 어떤 편향을 우선 점검할지를 좁혀준다.

### Step 3 — Scan Layer 1: Judgment Biases

| Bias | Signal |
|------|--------|
| Confirmation bias | 확인 정보만 찾고 반증 정보는 피했다 |
| Availability heuristic | 최근/생생한 사례가 추정을 지배한다 |
| Anchoring | 첫 숫자/정보가 이후 모든 추정에 묻어 있다 |
| Sunk cost | 과거 투자가 현재 결정의 근거가 된다 |
| Optimism / planning fallacy | 일정/결과를 낙관 쪽으로 일관 추정한다 |
| Framing effect | 같은 정보를 다르게 제시하면 결론이 바뀐다 |
| Hindsight bias | "그럴 줄 알았다" — 사후에 예측 가능성을 과대평가 |

### Step 4 — Scan Layer 2: Attribution Errors

- **Fundamental attribution error**: 타인 행동을 성격으로, 자기 행동을 상황으로 설명
- **Self-serving attribution**: 성공 = 실력, 실패 = 환경
- **Actor-observer asymmetry**: 본인엔 관대, 타인엔 엄격
- **Group attribution**: 한 명의 행동을 그룹 전체로 일반화

### Step 5 — Scan Layer 3: Metacognitive Accuracy

- **Overconfidence / Dunning-Kruger**: 잘 모르는 영역일수록 자신 있다
- **Underconfidence / imposter**: 충분한 증거가 있는데도 회의적이다
- **Illusion of explanatory depth**: "설명할 수 있다"고 느끼지만 실제로는 못 한다 (간단히 "왜?"를 3번 물어봐서 확인)
- **Bias blind spot**: 남의 편향은 보이는데 자기 편향은 안 보인다 — 이 스킬을 적용하는 본인에게도 적용된다

### Step 6 — Prescribe Debiasing Remedies (NEW)

식별된 편향마다 구체적 보정 행동을 매핑한다. 명명만 하면 효과가 적다 — 행동 처방이 있어야 보정된다.

| Bias | Remedy |
|---|---|
| Confirmation bias | 반증 가설 명시 + "이 결론이 틀렸다면 어떤 증거가 보일까?" 적어두기 |
| Availability heuristic | base rate 찾기 — 최근 사건이 아니라 장기 빈도로 비교 |
| Anchoring | 다른 출처에서 독립 추정치 1개 더 — 두 추정의 중간값 사용 |
| Sunk cost | "이 결정이 처음부터 시작이라면 지금 시작하겠는가?"로 재질문 |
| Optimism / planning fallacy | reference class forecasting — 유사 작업의 실제 소요 시간 3건 |
| Framing effect | 같은 정보를 반대 프레임(이득→손실, 손실→이득)으로 재진술 후 결론 비교 |
| Hindsight bias | 사건 전 본인이 적은 예측을 찾아 비교; 없으면 "예측 가능했다" 주장은 신뢰 X |
| Fundamental attribution error | "이 사람이 처한 제약·인센티브·정보가 나와 같다면 나는 어떻게 행동했을까?" |
| Self-serving attribution | 친구가 같은 결과를 냈다면 뭐라고 설명할지 적어보기 |
| Overconfidence | calibration check (Step 7)로 강제 정량화 |
| Illusion of explanatory depth | "왜?"를 3번 — 답이 막히면 설명 가능성 착각 |

### Step 7 — Calibration Self-Check (NEW)

본인 판단에 confidence가 높다고 느낄 때, 강제 정량화:

1. **베팅 odds**: "이 판단이 맞다는 데 100만 원 걸 수 있나? 50:50도? 60:40? 90:10?" — 입으로 말한 숫자가 실제 confidence다
2. **Base rate**: "지난 5번의 유사 판단에서 내가 맞았던 비율은?" — 모르면 100점 만점 자신감은 보정 대상
3. **반대 증거 1개**: 결론에 반대되는 가장 강한 증거 하나를 적는다. 없으면 confirmation bias가 켜져 있다는 신호
4. **5분 후 재질문**: 같은 판단을 5분 뒤 다시 적어본다. 표현이 흔들리면 신념이 아니라 인상이다

### Step 8 — Deliver the Audit

실제로 작동 중인 편향만 flag. 추측은 표시.

## Output Template

```
편향 감사 결과 / Bias Audit Results

상황 트리거 / Context Triggers:
- [켜진 트리거 1] → [예상되는 편향 카테고리]
- [켜진 트리거 2] → ...

판단 편향 / Judgment Biases:
[Bias 이름]: [구체적 발현]
Remedy: [Step 6 매핑된 행동]

귀인 오류 / Attribution Errors:
[오류 유형]: [어디서 보이는가]
Alternative: [현재 설명이 무시하는 상황 요인]

메타인지 / Metacognitive Accuracy:
Confidence: [calibrated / overconfident / underconfident]
Calibration check: [Step 7 결과 한 줄]

핵심 편향 / Primary Bias:
[가장 결정에 큰 영향 끼치는 편향 — 가장 우선 보정해야 할 한 개]
이 편향의 remedy를 실행하지 않으면 결론을 신뢰하지 마라.
```

## Anti-patterns

**편향을 이름만 부르지 마라.** "확증편향이 있네"로 끝나면 효과 0. remedy로 끝나야 한다.

**모든 편향을 다 찾지 마라.** 실제로 작동 중인 것만. 없는 편향을 만들어 붙이면 진단 자체의 신뢰가 깎인다.

**자기에게도 적용하라.** bias blind spot — 이 audit을 수행하는 너 자신에게도 같은 편향이 작동할 수 있다. 결론을 너무 깔끔하게 정리했다면 그게 신호다.

**Confidence가 높으면 더 깊이 봐라.** "이건 명백하다"는 가장 위험한 신호다. Step 7 (calibration) 필수.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| 3 레이어 + 트리거 + remedy 매핑 체계적 실행 | 판단을 구체적으로 진술 |
| 실제 작동하는 편향만 명명 | 어느 trigger가 켜져 있었는지 솔직히 답 |
| 편향별 구체 remedy 처방 | 처방된 remedy를 실제로 수행 후 재판단 |
| 핵심 편향 1개로 압축 | 그 한 개를 보정하고 결정 |

## Related Skills

- `fallacy-detector` — 논증 구조 결함일 때
- `epistemic-reasoner` — 증거 대비 confidence 정량 보정이 필요할 때
- `assumption-extractor` — 편향이 아니라 숨은 전제가 문제일 때
- `devils-advocate` — overconfidence가 flag되면 결정 자체에 강한 반론을 던져 stress-test
