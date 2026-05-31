# 13. Operational Layer

지금까지의 문서는 *무엇이 룰인가*를 정의했다. 이 문서는 **설치된 하네스가 AI 세션에서 실제로 어떻게 작동하는가**를 정의한다 — 무엇을 언제 로드하고, 무엇을 코드로 강제하고, 어긴 것을 어떻게 기록하고, 매 턴 토큰을 얼마나 쓰는가.

`devils-advocate.md`의 `CA-1`(작동 메커니즘 부재)을 닫는 문서이며, [`GOAL.md`](./GOAL.md) §3.3(AI 작동 메커니즘 명시)의 충족 조건이다. 동시에 *다음 단계인 토큰 최적화의 작업 정의*다 — 무엇을 최적화할지가 여기서 정해진다.

## §0. 핵심 원칙: 룰을 들고 다니지 마라

하네스의 룰을 *매 턴 컨텍스트에 싣는* 순간 두 가지가 동시에 망가진다:

1. **토큰** — 30~50KB 룰을 사이클 내내 캐리하면 사이클당 비용이 폭증
2. **신뢰** — 룰이 *narrative*로만 존재하면 AI가 일관 해석하지 못하고(`CA-1`), 사용자가 override하면 막을 길이 없다(`CV-1`)

→ **해법은 하나의 화살이다: 룰을 코드/스키마/트리거로 옮긴다.** 그러면 (a) AI가 안 들고 다니고, (b) 코드가 물리적으로 강제하고, (c) 어긴 것이 기록된다. 토큰과 self-enforcement를 *같은 전환*으로 산다.

```
나쁨:  매 턴 컨텍스트 = [12개 문서 전체]           → 비쌈 + 표류
좋음:  매 턴 컨텍스트 = [tier A 최소 코어]
              + 코드가 강제하는 게이트(들고 다닐 필요 없음)
              + 트리거 시에만 로드되는 tier B/C
```

---

## §1. Loading Policy — 3-Tier

매 턴 컨텍스트에 들어가는 것을 세 단계로 나눈다. 토큰 예산은 *상한*이며 초과 시 §6 eviction.

### Tier A — 항상 로드 (≤ 2K 토큰)

세션 내내 컨텍스트에 상주. *최소한의 불변 코어 + 현재 위치*만.

| 내용 | 출처 | 형태 |
|---|---|---|
| L0 Core invariant 5개 (요약) | `12 §4` | 1줄씩 압축 |
| 현재 사이클 ID + 단계 | `cycles/active/cycle-card.md` | 헤더만 |
| 활성 가설 1줄 + Kill 임계값 | `cycle-card.md` | snapshot |
| 활성 L2/L3 룰 *목록* (본문 아님) | `project-rules.md`, `exemptions.md` | ID + 한 줄 |

주입 방법: `SessionStart` hook (`hook-cycle-context`)이 컴파일해서 주입. AI가 문서를 *읽지* 않는다 — hook이 *압축본*을 준다.

### Tier B — 트리거 시 로드 (≤ 5K 토큰)

특정 *단계* 또는 *상황*에 진입할 때만.

| 트리거 | 로드 | Hook |
|---|---|---|
| 단계 키워드 (`persona`/`srs`/`architecture`/`stack`/`db`/`deploy`) | 그 stage의 룰 (`rules-load.py <stage>`) | `hook-stage-rules` |
| situational 키워드 (`auth`/`PII`/`migration`/`SLO`) | 해당 `situational-rules/*.md` | `hook-stage-rules` 확장 |
| 게이트 도달 (`gate`/`검증`/`pass`) | `08-pass-criteria.md` 해당 절 | on-demand |
| 활성 분기 카테고리 AP 5개 | `11-anti-patterns.md` 1개 카테고리 | `PF-7` rotation |

### Tier C — 명시 요청 시만 (∞)

사용자나 AI가 *명시적으로* 부를 때만 전체 로드.

- AP 카탈로그 전체 (25~30개)
- `templates/*` 전체
- 과거 사이클 retro
- `04-unknowns.md` 프레임워크 설명

### Tier 결정 규칙

> **"항상 필요한가?"** → Tier A. **"이 상황에서만 필요한가?"** → Tier B. **"드물게, 의도적으로 부를 때만인가?"** → Tier C.

새 룰/문서를 추가할 때 *반드시 tier를 선언*한다. tier 없는 콘텐츠는 기본 Tier C (즉 자동 로드 안 됨).

---

## §2. Trigger → Load → Apply 파이프라인

`CA-1`의 핵심 빈칸 — *설치 후 AI가 무엇을 다르게 하는가*. 사용자 발화/사건이 하네스의 어느 부분을 활성화하는지의 명시적 매핑.

```
[사건]                    [Trigger]              [Load]                  [Apply]
────────────────────────────────────────────────────────────────────────────────
세션 시작              SessionStart hook      Tier A 코어 주입        현재 위치 인식
"persona 작업할게"      UserPromptSubmit       Tier B: persona 룰      그 단계 룰로 응답
                       키워드 매칭             + 01-product-track 해당절
"이거 배포하자"         UserPromptSubmit       kill-check.py 실행      Hard면 차단(§3)
                       deploy 키워드           + deploy 룰
파일 수정 (가설 파일)   PreToolUse             hash 검증               변조면 차단(§3)
도구 호출 (WIP 위반)    PreToolUse             active symlink 확인     WIP>1이면 경고+기록
사이클 종료            Stop                   retro 템플릿 제시        carryover 분류 유도
룰 어김 발생           PostToolUse            black box append(§4)    막지 않음, 기록만
```

### 적용 우선순위 (충돌 시)

1. **L0 Core invariant 위반** → 무조건 차단 (override 불가)
2. **L3 > L2 > L1 > L0 Default** → `12 §2` layer 우선순위
3. **같은 layer 충돌** → 사용자에게 결정 요청 (자동 해석 금지 = AP-26)

### AI의 행동 계약

- 적용한 룰의 *출처를 명시*: "L2 `R-PROJ-FMT01`에 따라 tab 적용"
- Tier A에 없는 룰이 필요하면 *로드를 선언*하고 가져옴: "이 단계는 DB 룰이 필요 — `rules-load.py db` 로드"
- 룰을 *기억에서* 적용하지 않는다. 항상 *현재 로드된 것*에서.

---

## §3. Rules-as-Code 경계 (= Computational vs Inferential)

무엇을 *코드(hook/script)가 강제*하고, 무엇을 *narrative(AI 판단)*로 두는가. 이 경계가 토큰과 신뢰를 동시에 결정한다.

> **어휘 정렬 (Böckeler)**: 이 §3의 두 구분은 그녀의 *실행 모드*와 정확히 같다 — "코드로 강제" = **Computational**(결정론적, ms, 차단 가능), "narrative 판단" = **Inferential**(의미론적, 비결정론적, 풍부). 우리는 이 분류를 독립적으로 도달했고, 그녀의 프레임워크가 그것을 검증한다. (`00 §0.2b` 참조)
>
> **제어 방향 (Guide/Sensor)도 태그한다**: 각 메커니즘이 행동 *전* 조종이면 **Guide**, 행동 *후* 관측·교정이면 **Sensor**. harness가 *제대로* 작동하려면 둘 다 필요하다 — Guide만 있으면 사후 교정이 없고, Sensor만 있으면 사전 예방이 없다.

### 코드로 강제 (AI가 안 들고 다님)

*객관적으로 판정 가능*하고 *위반이 치명적*인 것만:

| 룰 | 메커니즘 | Hook/Script |
|---|---|---|
| 룰 | 메커니즘 | Hook/Script | Guide/Sensor |
|---|---|---|---|
| 가설 immutability | SHA-256 hash chain + `PreToolUse` 차단 | `hypothesis-register.py` + `hook-hypothesis-immutability` | **Sensor** (변조 사후 감지·차단) |
| WIP = 1 | `cycles/active` symlink 단일성 검사 | `hook-cycle-wip` | **Guide** (행동 전 차단) |
| Kill criteria (배포 게이트) | 임계값 비교 → exit 2면 차단 | `kill-check.py` + `hook-deploy-kill-check` | **Sensor** (지표 관측 후 차단) |
| L3 sunset 만료 | 날짜 비교 → 만료 면제 무효화 | `hook-l3-sunset-check` | **Guide** (적용 전 유효성) |
| 스타일/포맷 | toolchain 위임 (설정 존재만 검사) | `hook-formatter-config-exists` | **Guide** (설정 강제) |

이 5개는 모두 **Computational**(결정론적)이고 *narrative에서 빠진다*. AI가 컨텍스트로 캐리하지 않는다 — 코드가 한다.

### Narrative로 유지 (AI 판단)

*맥락 의존적*이고 *판정에 해석이 필요*한 것:

- 페르소나 품질, SRS 완전성, 가설의 falsifiability
- Design Doc/ADR의 논리, trade-off의 공정성
- "이 단계를 건너뛰어도 되는가" 류의 판단

이들은 Tier B로 *트리거 시 로드*되어 AI가 판단한다. 코드로 강제 불가.

### 경계 결정 규칙

> **기계가 yes/no로 판정 가능 + 위반이 치명적** → 코드. **해석이 필요 + 맥락 의존** → narrative.

애매하면 narrative. 코드 게이트를 늘리는 것 자체가 `AP-05`(harness ceremony) 위험.

---

## §4. Black Box — 막지 말고 기록

`CV-1`(author=enforcer=target)에 대한 가장 강건한 대응. 차단(hook block)은 *hook을 끄면* 무력화된다. 그러나 *기록*은 끄기 어렵고, 사후에 자기기만을 깬다.

### 원리

> 솔로 dev가 룰을 어기는 *동기*는 외부 감사 통과가 아니라 **자기 설득**이다. 자기 설득은 retro에서 *원문 기록*을 마주하면 깨진다. flight recorder처럼.

### 무엇을 기록하나

`cycles/active/blackbox.jsonl` — append-only:

```jsonl
{"ts":"2026-05-31T14:02Z","event":"rule_override","rule":"R-LP01","layer":"L0-default","reason":"긴급 픽스","via":"L3 exemption"}
{"ts":"2026-05-31T15:40Z","event":"gate_soft_fail","gate":"kill-check","detail":"시간 160% — soft","action":"계속 진행 선택"}
{"ts":"2026-05-31T16:20Z","event":"stage_skip","stage":"design-doc","reason":"이번엔 작아서 생략"}
```

기록 대상: 룰 override, soft-fail 후 강행, 단계 생략, 가설 재해석 시도, WIP 초과.

### 차단 vs 기록 구분

| 사건 | 처리 |
|---|---|
| L0 Core invariant 위반 | **차단** (§3) — 기록도 함께 |
| L0 Default / L1 / L2 override | **기록만** — 진행은 허용 |
| Soft kill 후 강행 | **기록만** |
| 단계 생략 | **기록만** |

즉 *invariant만 막고, 나머지는 자유롭게 어기되 black box에 남긴다*. 자유가 self-enforcement를 죽이지 않는 이유는 §4.4.

### Retro에서의 대면 (강제 루프)

`Stop` hook(`hook-retro-on-stop`)이 사이클 종료 시 `blackbox.jsonl`을 *통째로 retro 앞에 제시*한다:

> "이번 사이클에서 7건의 override/skip이 있었다. 각각이 정당했는가? 패턴이 보이는가?"

이 대면이 *다음 사이클*의 행동을 바꾼다. black box는 처벌이 아니라 *학습 carryover*의 원료다 (`07` 살림/의심/버림과 연결).

---

## §5. Prompt Caching 정렬

거의 공짜로 토큰을 산다. Opus의 프롬프트 캐싱은 *stable prefix*를 재사용한다 — 매 턴 같은 콘텐츠는 캐시 히트.

### 설계

```
[캐시되는 안정 prefix]  ← 거의 안 변함 → cache hit
├─ 하네스 Tier A 코어 (L0 Core 5개 + AI 행동 계약)
├─ 현재 사이클 cycle-card snapshot (사이클 내내 안정)
└─ 활성 L2 project-rules 목록

[캐시 안 되는 가변 suffix]  ← 매 턴 변함
├─ 사용자 발화
├─ Tier B 트리거 로드 (단계마다 다름)
└─ 작업 중 파일 내용
```

### 규칙

- Tier A는 *prefix에* 둔다 — 사이클 중 거의 안 변하므로 캐시 히트 극대화
- cycle-card snapshot이 바뀌면(단계 전환) 캐시 1회 무효화는 감수 — 단계 전환은 드묾
- Tier B/C는 *suffix*에 — 어차피 가변이라 캐시 대상 아님
- black box append는 *파일*이지 컨텍스트가 아니므로 캐시에 영향 없음

### 효과

사이클 내내 Tier A(~2K)가 캐시되면 매 턴 *그만큼*을 재처리하지 않는다. 단계가 5~6개, 턴이 수십~수백이면 누적 절감이 크다.

---

## §6. Token Budget per Turn

매 턴 하네스가 쓰는 컨텍스트의 *상한*과 초과 시 정책.

### 예산

| Tier | 상한 | 초과 시 |
|---|---|---|
| A (always) | 2K | 압축 강화 — 룰 본문 제거, ID+1줄만 |
| B (trigger) | 5K | 가장 안 쓰는 stage 룰부터 evict |
| C (on-demand) | 무제한 | 사용 후 즉시 drop (다음 턴 캐리 X) |
| **합계/턴** | **~7K** | 초과 시 아래 eviction |

### Eviction 정책 (LRU 변형)

예산 초과 시 버리는 순서:

1. **Tier C 먼저** — 명시 요청분은 *그 턴만* 살고 버려짐
2. **안 쓰는 Tier B** — 현재 단계와 무관한 stage 룰
3. **Tier A는 마지막** — 절대 통째로 안 버림. 초과 시 *압축*(본문→ID)으로 대응

### 측정

`scripts/`에 `context-budget.py`(신규 예정) — 현재 로드된 tier별 토큰을 추정해 예산 초과를 경고. 구현은 실전 1사이클 후.

---

## §7. 토큰 최적화 다음 단계 (이 문서가 정의하는 작업)

`CA-3`의 지적 — *"압축이 아니라 구조가 문제"*. 이 문서로 구조가 정해졌으니, *그 다음* 최적화 작업이 비로소 정의된다:

| 순서 | 작업 | 이 문서의 근거 |
|---|---|---|
| 1 | Tier A 코어를 ≤2K로 압축한 *컴파일 산출물* 생성 | §1 Tier A |
| 2 | `rules-load.py`를 Stage+Layer+Tier 필터로 확장 | §1 Tier B |
| 3 | 코드 강제 5개 hook 실제 구현 | §3 |
| 4 | `blackbox.jsonl` + `hook-retro-on-stop` 구현 | §4 |
| 5 | prefix/suffix 분리로 캐싱 정렬 | §5 |
| 6 | `context-budget.py` 측정 도구 | §6 |

*압축은 1번 안에서만* 일어난다 — 잘못된 구조를 압축하지 않기 위해 §1~6이 먼저다.

---

## §8. What Claude Does / What You Do

### Claude

- 세션 시작 시 Tier A만 로드된 상태로 작동 — 전체 문서를 읽지 않음
- 단계/상황 진입 시 *Tier B 로드를 선언*하고 가져옴
- 룰 적용 시 *출처(layer + ID)* 명시
- invariant 위반은 차단, 나머지 위반은 *black box에 기록하고 진행 허용*
- 사이클 종료 시 black box 전체를 retro 앞에 제시

### You

- 새 룰/문서 추가 시 *tier 선언* 필수 (없으면 Tier C = 자동 로드 안 됨)
- 코드 강제 5개의 hook을 실제 구현 (실전 1사이클 후 우선순위대로)
- retro에서 black box를 *실제로 대면* — 건너뛰면 §4 전체가 무력
- override는 자유롭되, 그것이 기록됨을 인지

## §9. Anti-patterns 연결

| 이 문서가 막는 것 | AP |
|---|---|
| 룰을 매 턴 캐리해서 토큰 폭증 | `AP-05` Harness ceremony |
| 룰을 기억에서 적용(표류) | `CA-1` (DA log) |
| invariant override 시도 | `AP-27` |
| black box 대면 회피 | 신규 — `AP-31` Black box 외면 (`11`에 추가 필요) |

## §10. 관련 문서·도구

- `GOAL.md` §3.3 — 이 문서가 충족하는 조건
- `devils-advocate.md` `CA-1`/`CA-3`/`CV-1`/`PF-1`/`PF-3` — 이 문서가 닫는 항목
- `12-rule-layering.md` — layer 우선순위(§2 적용 우선순위의 근거), tool-pointer(§3)
- `06-rules.md` — Tier/Scope/Layer 메타 부착 필요
- `07-looping-mechanics.md` — black box → carryover 연결(§4.4)
- `hooks/README.md` — §2~§4의 hook 실제 카탈로그
- `scripts/rules-load.py` — Tier 필터 확장 대상(§7-2)
- `scripts/` — `context-budget.py` 신규(§6)
