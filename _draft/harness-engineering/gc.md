# Entropy GC for AI Harness Engineering

> AI 모델에게 일을 시키는 프레임워크(Harness)에서, 컨텍스트에 누적되는
> 무질서(Entropy)를 감지하고 정리하는 메커니즘에 대한 설계/구현 가이드.

---

## 1. 배경 개념

### 1.1 AI Harness란?

AI 모델을 실제 작업에 연결하는 프레임워크/오케스트레이션 계층이다.
모델 자체가 아니라, 모델에게 **무엇을 어떤 맥락으로 시킬지** 관리하는 인프라를 말한다.

```
[사용자/시스템]
      │ 지시(Task)
      ▼
┌─────────────────────────────┐
│         AI Harness          │
│                             │
│  - 프롬프트 조립             │
│  - 컨텍스트(Context) 관리    │
│  - Tool 호출 및 결과 수집    │
│  - 메모리(단기/장기) 관리     │
│  - 루프 제어                 │
└─────────────────────────────┘
      │ 조립된 컨텍스트
      ▼
   [LLM 호출]
      │
      ▼
   [결과/액션]
```

대표 프레임워크: LangChain, LlamaIndex, CrewAI, AutoGen, Letta(MemGPT) 등.

### 1.2 엔트로피(Entropy)란?

작업이 진행될수록 컨텍스트에 쌓이는 **노이즈·무질서**를 의미한다.
정보이론에서 엔트로피가 "불확실성/무질서도"를 뜻하는 것과 같은 맥락이다.

엔트로피가 높아지면:

```
노이즈 많은 컨텍스트
    → 모델이 신호와 잡음을 구분하기 어려움
    → 판단 품질 저하 / 환각 증가
    → 같은 작업 반복
    → 토큰 한계 초과 → 실패
```

### 1.3 엔트로피 GC란?

> **컨텍스트에 누적된 엔트로피를 감지하고, 불필요한 부분을 제거·압축하여
> 모델이 항상 깨끗한 작업 맥락을 유지하도록 하는 메커니즘.**

JVM GC가 힙에서 더 이상 참조되지 않는 객체를 회수하는 것과 같은 역할을,
AI Harness에서는 컨텍스트 윈도우에 대해 수행한다.

| JVM GC | AI Harness Entropy GC |
|---|---|
| 힙 메모리 | 컨텍스트 윈도우 |
| 참조 없는 객체 | 더 이상 필요 없는 정보 |
| Reachability 분석 | 관련성(Relevance) 판단 |
| Mark & Sweep | 식별 후 제거 |
| Compaction | 요약(Summarization) |
| Generational GC | 단기/장기 메모리 분리 |
| GC Roots | 시스템 프롬프트, 현재 Task 목표 |

---

## 2. 엔트로피 발생원

| 종류 | 설명 | 위험도 |
|---|---|---|
| **Stale 결과** | 이미 완료·소비된 스텝의 출력이 계속 남음 | 중 |
| **실패 잔재** | 실패한 Tool 호출 에러/스택트레이스 누적 | 중 |
| **중복 정보** | 동일 내용이 여러 턴에 반복 등장 | 높음 |
| **무관 정보** | 현재 Task와 관련 없는 과거 기억 유입 | 높음 |
| **장황한 추론** | 모델의 길고 반복적인 중간 사고 과정 | 중 |
| **Raw 덤프** | 검색/DB 결과 원본이 가공 없이 통째로 적재 | 높음 |

---

## 3. GC 전략 (4가지 핵심 기법)

### 3.1 Sliding Window (슬라이딩 윈도우)
가장 단순. 최근 N개 메시지/턴만 유지하고 나머지는 버린다.

```
[유지] 최근 turn N개
[버림] 그 이전 전부
```

- 장점: 구현 단순, 비용 예측 가능
- 단점: 오래됐지만 중요한 정보(목표, 제약)도 날아감
- 보완: GC Roots(시스템 프롬프트, Task 목표)는 윈도우와 무관하게 항상 고정(pin)

### 3.2 Summarization / Compaction (요약 압축)
오래된 컨텍스트를 버리지 않고 **요약본으로 치환**한다.

```
[원본] turn 1~10 (3,000 tokens)
          │ 요약
          ▼
[압축] "1~10턴 요약: 사용자가 X를 요청, A/B 시도 실패, C가 유효함" (200 tokens)
```

- 장점: 정보 손실 최소화하며 토큰 절약
- 단점: 요약에 추가 LLM 호출 비용, 요약 품질이 곧 정보 품질
- 핵심: **무엇을 요약에 남길지** 기준이 곧 엔트로피 판단

### 3.3 Importance Scoring (중요도 스코어링)
각 컨텍스트 조각에 점수를 매기고, 낮은 것부터 제거한다.

```
score = w1 * recency        # 최근성
      + w2 * relevance       # 현재 Task와의 관련성
      + w3 * reference_count  # 이후 단계에서 참조되는 빈도
      + w4 * is_pinned        # 고정 여부(목표/제약)
```

- 장점: 가장 정교, 중요 정보 보존율 높음
- 단점: 스코어링 로직 설계·튜닝 부담
- relevance는 임베딩 유사도(현재 목표 vs 조각)로 계산 가능

### 3.4 Hierarchical Memory (계층형 메모리)
컨텍스트를 버리지 않고 **장기 저장소로 이동(swap-out)**, 필요 시 다시 불러온다(swap-in).
MemGPT/Letta의 핵심 아이디어.

```
┌────────────────────────────┐
│  In-Context (단기 메모리)    │  ← LLM이 즉시 보는 영역, 좁음
│  - 현재 작업 맥락            │
└────────────┬───────────────┘
             │ swap-out (엔트로피 높아지면 밀어냄)
             ▼
┌────────────────────────────┐
│  External Store (장기 메모리) │  ← Vector DB / Redis
│  - 전체 히스토리, 지식        │
└────────────┬───────────────┘
             │ swap-in (필요할 때 검색해서 회수)
             ▼
        다시 In-Context로
```

- 장점: 사실상 무한 컨텍스트, 정보 영구 보존
- 단점: 검색 정확도에 의존, 인프라 복잡도 증가

---

## 4. 언제 GC를 트리거하나 (Trigger Policy)

| 트리거 방식 | 조건 | 특징 |
|---|---|---|
| **Threshold 기반** | 컨텍스트 토큰 > 한계의 70~80% | 가장 일반적, 안전 |
| **Step 기반** | N 스텝마다 / Task 완료 시 | 주기적, 예측 가능 |
| **Event 기반** | Tool 호출 종료, 서브태스크 완료 직후 | 자연스러운 경계에서 정리 |
| **Hybrid** | Threshold + Event 조합 | 실무 권장 |

> 권장: 평소엔 **Event 기반**(서브태스크/툴 호출 경계)으로 가볍게 정리하고,
> 토큰이 임계치를 넘으면 **Threshold 기반**으로 강제 압축한다.

---

## 5. 실제 구현 방법론 (Step by Step)

### Step 1. 컨텍스트를 구조화한다
컨텍스트를 단순 문자열이 아니라 **타입이 있는 조각(segment)들의 리스트**로 관리한다.
타입이 있어야 GC 정책을 차등 적용할 수 있다.

```kotlin
enum class SegmentType {
    SYSTEM,        // GC 대상 아님 (pinned)
    TASK_GOAL,     // GC 대상 아님 (pinned)
    USER_INPUT,
    TOOL_CALL,
    TOOL_RESULT,
    REASONING,     // 가장 먼저 압축 대상
    SUMMARY
}

data class ContextSegment(
    val id: String,
    val type: SegmentType,
    val content: String,
    val tokens: Int,
    val createdStep: Int,
    val pinned: Boolean = false,
    var referencedCount: Int = 0
)
```

### Step 2. 엔트로피/중요도를 측정한다
각 조각에 중요도 점수를 부여한다. 낮을수록 GC 1순위.

```kotlin
class EntropyScorer(private val embedder: Embedder) {

    fun score(segment: ContextSegment, currentGoal: String, currentStep: Int): Double {
        if (segment.pinned) return Double.MAX_VALUE  // 절대 제거 안 함

        val recency   = 1.0 / (1 + (currentStep - segment.createdStep))
        val relevance = embedder.cosineSimilarity(segment.content, currentGoal)
        val reference = ln(1.0 + segment.referencedCount)
        val typeBias  = when (segment.type) {
            SegmentType.REASONING   -> -0.3   // 추론 과정은 빨리 버림
            SegmentType.TOOL_RESULT -> 0.0
            SegmentType.SUMMARY     -> 0.2    // 요약본은 보존 우대
            else                    -> 0.1
        }

        return 0.4 * recency + 0.4 * relevance + 0.2 * reference + typeBias
    }
}
```

### Step 3. GC 트리거를 건다 (Hybrid)
토큰 임계치 또는 작업 경계에서 GC를 호출한다.

```kotlin
class ContextManager(
    private val scorer: EntropyScorer,
    private val summarizer: Summarizer,
    private val maxTokens: Int = 8000,
    private val gcThreshold: Double = 0.75   // 75% 도달 시 GC
) {
    private val segments = mutableListOf<ContextSegment>()

    // Event 기반: 서브태스크/툴 호출 종료 시 호출
    fun onStepComplete(currentGoal: String, step: Int) {
        if (currentTokens() > maxTokens * gcThreshold) {
            runGC(currentGoal, step)
        }
    }

    private fun currentTokens() = segments.sumOf { it.tokens }
}
```

### Step 4. GC를 실행한다 (Mark → Sweep → Compact)

```kotlin
fun runGC(currentGoal: String, currentStep: Int) {
    // 1) MARK: 점수 산정 후 정렬
    val scored = segments
        .map { it to scorer.score(it, currentGoal, currentStep) }
        .sortedBy { it.second }

    // 2) SWEEP: 목표 토큰까지 낮은 점수부터 제거 대상 선정
    val targetTokens = (maxTokens * 0.5).toInt()  // 50%까지 줄임
    val toEvict = mutableListOf<ContextSegment>()
    var running = currentTokens()

    for ((seg, _) in scored) {
        if (running <= targetTokens) break
        if (seg.pinned) continue
        toEvict += seg
        running -= seg.tokens
    }

    // 3) COMPACT: 제거 대신 요약으로 치환 (정보 손실 최소화)
    if (toEvict.isNotEmpty()) {
        val summary = summarizer.summarize(toEvict.map { it.content })
        segments.removeAll(toEvict)
        segments.add(
            ContextSegment(
                id = "summary-$currentStep",
                type = SegmentType.SUMMARY,
                content = summary,
                tokens = estimateTokens(summary),
                createdStep = currentStep,
                pinned = false
            )
        )
    }
}
```

### Step 5. 계층형 메모리로 확장한다 (선택)
제거 대신 외부 저장소로 swap-out하고, 필요할 때 검색해서 회수한다.

```kotlin
class HierarchicalMemory(
    private val vectorStore: VectorStore,   // 장기 메모리
    private val redis: RedisTemplate<String, String>
) {
    // swap-out: 컨텍스트에서 밀려난 조각을 장기 메모리로
    fun evict(segment: ContextSegment) {
        vectorStore.upsert(segment.id, segment.content, embed(segment.content))
    }

    // swap-in: 현재 목표와 관련된 과거 기억을 다시 불러옴
    fun recall(currentGoal: String, topK: Int = 3): List<String> {
        return vectorStore.search(embed(currentGoal), topK)
            .map { it.content }
    }
}
```

---

## 6. 구현 시 주의사항 (실무 체크포인트)

1. **GC Roots는 절대 건드리지 않는다**
   - 시스템 프롬프트, 현재 Task 목표, 핵심 제약조건은 항상 pinned.
   - 이걸 날리면 AI가 자기가 뭘 하는지 잊어버린다.

2. **요약 자체가 엔트로피가 되지 않게 한다**
   - 요약본을 또 요약하는 과정에서 정보가 변질될 수 있다(요약의 요약 문제).
   - 원본 핵심 사실(숫자, ID, 결정사항)은 요약 시 명시적으로 보존하도록 지시한다.

3. **GC 비용 vs LLM 호출 비용을 저울질한다**
   - Summarization은 추가 LLM 호출이라 비용이 든다.
   - 너무 자주 GC하면 배보다 배꼽이 커진다 → 트리거 임계치 튜닝 필요.

4. **결정론적 우선, LLM 판단은 최후에**
   - "오래됨/중복/실패 로그"는 규칙(룰)으로 먼저 제거한다(싸고 빠름).
   - 애매한 관련성 판단만 임베딩/LLM에 맡긴다.

5. **GC 로그를 남긴다 (Observability)**
   - 무엇을 언제 왜 버렸는지 기록한다.
   - 나중에 "AI가 그걸 왜 잊었지?" 디버깅의 핵심 단서가 된다.

6. **멱등성·복원 가능성**
   - 계층형 메모리 사용 시, swap-out한 정보는 반드시 복원(recall) 가능해야 한다.
   - 영구 삭제는 정말 불필요한 것(실패 로그 등)에만 적용한다.

---

## 6.5 표면 엔트로피 GC — 런타임의 사촌 (리포지토리판)

위 §1~§6은 *런타임 컨텍스트 윈도우*의 엔트로피를 다룬다. 그 **사촌**이 *리포지토리 표면*의
엔트로피 — 시간이 지나며 드리프트한 죽은 링크·relic 디렉토리·중복 파서·**문서가 거짓 주장하는 상태**다.
하네스는 이 표면판을 `GOLDEN-PRINCIPLES.md`(선언) + `gc-scan.py`(스캐너)로 자기 코드에 적용한다(원칙6).

| 런타임 엔트로피 (§1~§6) | 표면 엔트로피 (이 절) |
|---|---|
| 컨텍스트 윈도우 | 리포지토리 파일 트리 |
| stale 결과·실패 잔재 | dead-link(GP-2)·relic 디렉토리(GP-1) |
| 중복 정보 | 중복 파서(GP-3, Rule-of-Three) |
| 무관 정보 유입 | 의미적 stale — 문서 주장 vs 코드 현실(GP-4) |
| 컨텍스트 비대 | 아키텍처 복잡도 — 메커니즘 수(GP-5) |
| Mark & Sweep | `gc-scan.py` 결정론 스캔 |

### 결정론 ↔ 사람 판단의 경계 (§6 주의사항 4번의 표면 버전)

§6.4는 말한다 — *"결정론적 우선, LLM/사람 판단은 최후."* 표면 GC에서 이 경계가 **GP의 등급**을 가른다:

- **결정론이 닿는 곳 = high-confidence**: dead-link(GP-2)는 경로 resolve로 환원된다 → 스캐너가
  자동 판정하고 *fixpoint 0*(정리 후 재실행 시 0)을 강제. 자동 수선 가능.
- **결정론이 *못* 닿는 곳 = watch + 사람 의식**: "문서가 *주장*하는 상태가 코드 현실과 맞나"(GP-4)는
  문서의 *의미*를 읽어야 풀린다 — 경로 resolve로 환원 불가. signpost↔relic 판별(GP-1)도 동형.
  스캐너는 이걸 *대신 판정하지 않고*, **읽어야 할 지점의 체크리스트**를 watch로 상기시킨다.

### 의미적 stale은 *적극적 오정보* — dead-link보다 나쁘다 (#011 F2)

GP-4의 전형: `hooks/README.md`가 "모든 hook 미구현"이라 주장하나 *실제 5개 구현*. dead-link는
에이전트를 막다른 길로 보내지만, 의미적 stale은 에이전트가 "안 되어 있구나" *믿고 이미 있는 걸 다시
만들게* 한다 — 거짓 지도(원칙1 위반)의 더 교활한 형태. 그래서 GC 의식은 **mandatory 내용검토 단계**를
포함한다: 스캔(결정론) → high-confidence fixpoint(자동) → **GP-4 체크리스트 전수 검토(사람/LLM)**.
"구현 상태"·"N개 구현"·"전부 미구현" 류 문장은 코드와 1:1 대조. 절차는 `GOLDEN-PRINCIPLES.md` §내용검토 의식.

### GC 실행 mandatory 체크리스트

GC 실행 시 스캔(결정론) → high-confidence fixpoint 다음, 아래 항목을 **전수 검토**한다.
자동탐지가 닿지 않는 의미적 stale(GP-4)·signpost↔relic 판별(GP-1)을 사람/LLM이 직접 확인.

- [ ] **hooks/README.md "현재 구현" 섹션**: 기술된 hook 파일명이 hooks.json 배선 목록과 1:1 일치하는가 ("전부 미구현" 역방향 stale 전례 — #011 F2)
- [ ] **plugin/harness/skills/\*/SKILL.md**: 안내하는 명령·플래그·로드 시점이 현재 스크립트 인터페이스와 일치하는가 (스킬 문서가 삭제된 flag를 참조하거나 변경된 UX를 오안내하지 않는가)
- [ ] **README.md · 13-operational-layer.md "N개 구현"·"N층 완성" 류 주장**: 현재 코드와 카운트가 일치하는가 (PF-9: 검증≠설계 언어 — 설계 시점 숫자가 구현 완료 후 맞는지 재확인)
- [ ] **GP-1 relic 후보 각각**: 구조 신호(코드 0+README만)가 뜨더라도 *내용* 읽어 signpost인지 relic인지 판별 (구조 휴리스틱 정밀도 0/2 전례 — 삭제 전 반드시 사람 판정)

### 교훈: GC조차 자기 검증이 필요하다 (#011 F1)

relic 자동삭제기(GP-1)는 첫 적용에서 0/2 정밀도였다 — *구조 신호로 signpost↔relic을 원리적으로 못
가른다*. "측정 먼저, 압축 나중"에서 *측정기 자체가 틀릴 수 있음*을 인정해야 한다. high-confidence를
함부로 주지 않는 규율 — **내용 판단이 필요한 건 high-confidence가 아니다** — 이 한 줄이 표면 GC의 핵심.

---

## 7. 의사결정 가이드

| 상황 | 권장 전략 |
|---|---|
| 단순 챗봇, 짧은 대화 | Sliding Window |
| 멀티스텝 에이전트, 툴 사용 | Importance Scoring + Summarization |
| 장기 작업, 지식 누적 필요 | Hierarchical Memory (MemGPT 방식) |
| 비용 극도로 민감 | 룰 기반 제거 위주, LLM 요약 최소화 |
| 복잡한 멀티에이전트 협업 | 에이전트별 컨텍스트 격리 + 공유 메모리 분리 |

---

## 8. 핵심 요약

```
엔트로피 GC = 컨텍스트 위생 관리

원칙:
  1. GC Roots(목표/시스템)는 고정
  2. 룰로 먼저 버리고(싼 것), LLM 판단은 나중에(비싼 것)
  3. 버리기보다 요약/외부화로 정보 보존
  4. Event 경계에서 가볍게 + 임계치에서 강제로
  5. 모든 GC는 로깅 (왜 잊었는지 추적 가능하게)

목표:
  모델이 언제나 "현재 작업에 필요한 만큼만,
  깨끗한 맥락"을 보도록 유지하는 것
```

