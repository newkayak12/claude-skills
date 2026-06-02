# Harness Engineering — Devil's Advocate Log

이 문서는 `_draft/harness-engineering/`에 대한 **누적 취약점 분석 로그**다. Goal([`GOAL.md`](./GOAL.md))을 향한 진행 과정에서 발견된 반론·약점·해소 경로를 *append-only*로 쌓는다.

## 로그 운영 규칙

- **ID는 전역 유일**: `HA-N` (Hidden Assumption) / `CA-N` (Counterargument) / `CV-N` (Core Vulnerability) / `PF-N` (Path Forward). 새 review에서도 이전 번호 이어서 매긴다 (예: Review #2의 첫 반론은 `CA-8`).
- **Review는 append**: 기존 review를 *수정하지 않는다*. 입장이 바뀌었으면 새 review에 reason과 함께 기록.
- **Resolution은 별도 절**: PF-N이 충족되면 본문 수정이 아니라 §Resolution log에 한 줄 추가.
- **Severity 갱신**: 기존 CA의 severity가 바뀌면 본문은 두고 §Severity revision에 `CA-N: high → medium (review #2에서 PF-N 충족으로)` 한 줄.
- **참조 방법**: 대화 중 "`CA-2` 보강" "`PF-3` 진행 중" "`CV-1` 해결 시도" 형태로.

## Review Index

| # | Date | Target state | IDs |
|---|---|---|---|
| 1 | 2026-05-28 | Concept stage (12 docs + scripts + hooks + templates + 4-layer rules) | HA-1..7, CA-1..7, CV-1, PF-1..7 |

---

# Review #1 — 2026-05-28 (Concept stage)

**대상**: `_draft/harness-engineering/` 전체 — 12 markdown docs + scripts/(4) + hooks/(16 spec-only) + templates/(5) + situational-rules/(5) + 4-layer rule system
**단계**: 컨셉 stage 중간 평가. 다음 단계는 token optimization 예정.
**Goal 기준**: [`GOAL.md`](./GOAL.md) §1 (marketplace 설치 → `harness:install` → interactive user-rule → 사이클 실행)

---

## Position

> Solo dev가 *install된 harness*를 AI와의 Q&A를 통해 환경 조성에 활용한다. 한 사이클(기획 → 개발 → 테스트 → 부하)을 빠뜨림 없이 끌고 가고, 다음 단계에서 token optimization으로 무게를 줄인다.

## Steel-man

이 제안이 작동할 수 있는 최선의 조건: *솔로 dev가 (a) 외부 PM/아키텍트 없이도 검증 단계를 강제하고 싶은 강한 동기를 가지고 있고, (b) AI가 정확한 시점에 정확한 룰만 로드하는 selective loading이 토큰 비용을 흡수할 정도로 효율적이며, (c) 12+ 문서의 룰이 코드/도구로 enforce되는 부분과 narrative로만 존재하는 부분이 명확히 분리되어 있을 때.*

---

## 숨은 가정 (Hidden Assumptions)

### HA-1: 솔로 dev가 *불편할 때* 하네스를 지킨다
하네스의 존재 이유 = 외부 규율 부재. 그러나 enforcer도 본인. 피곤·마감·흥분 상태에서 게이트를 건너뛰지 않을 거라는 가정은 외부 stakeholder가 없는 환경에서 입증된 적 없다.

### HA-2: AI가 12+ 문서를 *드리프트 없이* 일관 해석한다
같은 룰을 다른 세션에서 다르게 해석하지 않는다는 가정. 토큰 예산 안에서 selective loading해도 attention dilution은 남는다.

### HA-3: 솔로 dev에게 검증 루프를 채울 *피드백 소스*가 있다
페르소나/Pre-mortem/가설 사전 등록은 외부 사용자·동료 접근을 전제한다. 주말 프로젝트엔 5명의 인터뷰 대상이 없을 수 있다.

### HA-4: 하네스 오버헤드 < 막아주는 실패 비용
2주짜리 사이드 프로젝트에 12 docs of process를 적용할 가치가 있는 *최소 규모* 임계가 정의되지 않았다.

### HA-5: L0 Core invariant를 *사전에* 올바르게 분류할 수 있다
`12-rule-layering.md §7`은 도입 1단계에서 invariant 분류를 요구한다. 그러나 첫 사이클 *전*이라 데이터가 없는 상태에서의 분류다.

### HA-6: Token optimization이 *나중에* 구원해준다
이미 50KB+ markdown. 최적화로 lookup은 줄여도 *철학 자체*가 "many rules를 carry한다"는 모양이라 줄일 한계가 있다.

### HA-7: AI의 anti-pattern 탐지가 신뢰할 만한 false positive 비율을 가진다
25-30개 AP를 AI가 watching → 알람 빈도 증가 → 알람 피로 → muting. 검증 안 됨.

---

## 반론 (Counterarguments)

### CA-1: AI 환경에서 *작동 메커니즘*이 정의되지 않았다 `[structural]` · severity: **critical**

설치 후 AI가 정확히 *무엇*을 다르게 하는지 명시되어 있지 않다. 매 턴 12 docs를 읽는가? Stage 태그로 selective load? Hook이 트리거할 때만? 현재 README는 "문서가 있다"와 "AI가 적용한다" 사이에 *operational layer*가 비어 있다. 이 빈칸 없이는 토큰 최적화도 *무엇을 최적화할지*가 정의되지 않는다 — 즉 다음 단계의 작업 정의가 현재 단계에서 빠져 있다.

**선례**: CLAUDE.md 시스템 — 사용자가 룰을 작성해도 모델이 일관 적용하지 않는 잘 알려진 패턴. Cursor `.cursorrules`도 같은 문제. 룰 파일은 *존재 증명*이지 *적용 증명*이 아니다.

### CA-2: Self-enforcement 패러독스 — 외부 규율 없이 외부 규율을 흉내낸다 `[structural]` · severity: **critical**

하네스는 "PM/아키텍트가 따로 없을 때"를 위해 만들어졌다. 그런데 PM/아키텍트의 *진짜 가치*는 그들이 **너의 결정을 거부할 수 있다**는 점이다. 본인이 작성·운영·target인 시스템에선 그 거부권이 작동할 수 없다. AI는 거부할 수 있다고 가정해도 sycophancy bias + override 가능 → "이번 한 번만 game 통과시켜줘"가 통한다. Hook이 hard block을 걸 수는 있지만 현재 hook은 **모두 spec-only**다.

**선례**: 개인 생산성 시스템 (GTD full implementation, Zettelkasten 완성형, Personal Kanban)이 일관되게 수주 후 폐기되는 패턴. 살아남는 건 *minimum viable version*이지 rich version이 아니다.

### CA-3: Token optimization 타겟이 잘못 잡혀 있다 — *모양* 자체가 무거움 `[assumption]` · severity: **high**

"다음 단계는 token optimization"이지만, 최적화 후에도 *철학상* 사이클마다 (06-rules + 12-rule-layering + situational 트리거 + AP 카탈로그 + cycle-card)를 봐야 한다. 30-50KB는 압축으로 떨굴 수 있어도, 매 Q&A 턴 컨텍스트에 들어가는 *모양*은 그대로다. 압축으로 풀 문제가 아니라 *processing pipeline 설계* 문제 — 무엇을 *항상* 로드하고 무엇을 *호출 시* 가져올지, 어떤 룰을 코드/스키마로 옮길지의 결정이 누락됐다. 압축은 *결정 후*의 마무리 작업이지 *결정 자체*가 아니다.

**선례**: 거대 wiki/Notion 워크스페이스가 검색 불가 상태로 자라는 패턴. Org-mode 수천 파일 KB가 본인에게도 indexable하지 않게 되는 경우. 두 경우 모두 *압축*이 아니라 *구조*가 문제였다.

### CA-4: 가설 SHA-256 해시 체인은 *연극(theater)* — 솔로 dev에겐 막을 게 다른 곳에 있다 `[execution]` · severity: **high**

해시 체인은 *post-hoc tampering*을 막는다. 그런데 솔로 dev에게 tampering의 *동기*는 "외부 감사 통과"가 아니라 "**자기 자신을 설득**"이다. 자기 설득은 파일 수정이 아니라 *내러티브 재구성*으로 이뤄진다 — "가설은 안 바꿨는데 *내가 정말 측정하려던 건* 좀 다른 거였어"가 통한다. `chmod -w`나 git commit으로도 같은 결과. 암호학적 게이트가 *진지함을 시그널링*하지만 *실제 실패 모드*(AP-06)는 *narrative 층*에서 일어난다.

**선례**: 명확한 단일 선례 없음 — speculative concern. 단, decision journals 연구에서 자기 평가가 사후에 *재해석*되는 패턴은 일반적.

### CA-5: Pre-cycle gate는 *이미 결심한 아이디어*를 위한 확인 의식이다 `[execution]` · severity: **high**

Pre-mortem + Cycle Card를 쓸 정도의 정신적 에너지를 투자했다면, 게이트는 **확인 편향의 기록**이 된다. 솔로 dev가 자기 점수를 매기는 5-group 매트릭스에서 0.3을 주는 경우는 거의 없다. 결국 *내가 통과시킬 수 있는 점수*가 나온다. 게이트가 진짜 잡고 싶은 건 motivated reasoning인데, 자기 채점은 정의상 그걸 우회한다.

**선례**: OKR self-rating 분포 — 자기 채점은 0.7~1.0에 몰린다. 외부 calibrator가 없는 채점 시스템은 시스템적으로 후하다.

### CA-6: 4-layer 룰은 *조직용 도구*를 솔로 dev에 강제한다 `[structural]` · severity: **medium**

L0/L1/L2/L3은 다수 작성자 간 priority 충돌 해소를 위한 구조다. 솔로 dev는 4개 layer의 *모든 작성자가 본인*이다. 진짜 충돌은 *과거-나 vs 현재-나*뿐이고 이건 layer 계층으로 풀 일이 아니라 *시간 메타데이터*(`set_at`, `last_reviewed`)로 풀 일에 가깝다. 현재 구조는 메타-오버헤드를 만든다: "이 룰을 L1에 둘까 L2에 둘까? 다른 프로젝트도 있을 거면..." → 결정에 대한 결정.

**선례**: npm의 5+ config 소스, Spring Boot profile inheritance — *팀이 쓰는* 다층 config도 사용자를 자주 혼란시킨다. 단일 작성자 다층은 더 과한 도구.

### CA-7: Anti-pattern 25-30개는 *재인식 가능 수*를 넘었다 `[execution]` · severity: **medium**

심리 연구의 working memory 상한(7±2)은 *동시 보유*에 대한 것이지만, *재인식*에도 비슷한 한계가 있다. 25-30개 AP는 "내가 지금 어느 AP에 가까운가"를 본인이 *느끼지* 못한다. AI가 탐지해야 하는데 (CA-1로 회귀) 그 탐지 메커니즘이 명시 안 됨. 카탈로그가 가치 있으려면 *분기별 회고에서 5개씩 골라 검토*하는 외부 cadence가 강제돼야 한다.

**선례**: Code smell 카탈로그(Fowler) 22개도 실무자가 *체크리스트*로 못 쓰고 결국 3-4개만 활성 사용. 압축 없이 카탈로그만 늘리는 건 자기만족.

---

## 다중 페르소나 공격

솔로 dev의 진짜 stakeholder는 *시간을 가로지른 본인*이다.

### 페르소나 1 — 3개월 후의 cold-context 본인

"이 프로젝트 다시 잡았는데 어디서부터 다시 봐야 하지? `cycles/2026-03-15/` 폴더 열어보니 `cycle-card.md`, `pre-mortem.md`, `gate-criteria.md`, `retro.md`, `metrics.json`, `exemptions.md` — 6개 파일. 내가 멈춘 *이유*가 어디 있는지 모르겠다. 4-layer 룰은 그때 L2가 뭐였는지 가물가물. Sunset 지난 L3 면제가 만료됐는지 확인해야 하는데 자동인지 수동인지 기억 안 남. 결과: 그냥 새로 만들고 옛 폴더 무시." → 하네스의 *재진입 비용*이 높다는 신호.

### 페르소나 2 — 마감 압박 받는 현재의 본인

"버그 픽스 하나 푸시하려는데 hook이 'L0 Default WIP=1을 위반합니다, L3 exemption 작성하시겠습니까?'라고 묻는다. 4분 안에 배포해야 함. `exemptions.md`를 새로 만들고 sunset 적고 reason 적고 cycle-card도 업데이트. 이게 5번째 발생하면 hook을 끈다. 끈 hook은 다시 안 켜진다." → AP-05 (Harness ceremony)가 *자기 자신에 의해* 트리거된다.

---

## 핵심 취약점 (Core Vulnerability)

### CV-1: *Author = Enforcer = Target* 삼위일체가 process의 작동 전제를 무너뜨린다

조직의 process가 작동하는 이유는 세 역할이 *분리*되어 있기 때문 — 룰을 만든 사람, 강제하는 사람, 적용받는 사람이 다르다. 분리가 없으면 룰은 *suggestion*이 된다. Harness는 분리 없이 *분리된 척*하는 시스템이다. AI가 enforcer 역할을 일부 흉내내지만, sycophancy + override 가능성 + spec-only hooks가 그 흉내를 신뢰 못 할 수준으로 약화시킨다.

이 결함은 HA-1(불편할 때도 지킨다)을 정면으로 부수고, CA-2(self-enforcement paradox)와 CA-5(self-rating bias)의 공통 뿌리다. 다른 모든 비판은 이 약점의 *증상*이다.

**무엇이 진짜 enforcer가 될 수 있는가**: (a) 코드가 실패를 *물리적으로* 막는 곳 (CI fail, pre-commit reject, hook hard block — 그러나 현재 spec-only), (b) 외부 사람의 시선 (오픈소스 PR, 사용자 인터뷰 약속, 공개 changelog). 둘 다 현재 하네스에서 약하거나 부재.

---

## 가역성 (Reversibility)

**reversible** — 컨셉 단계라 가지치기 자유롭다.

다만 *시간 경과에 따라 reversibility가 감소*한다: 매주 추가되는 문서는 *sunk-cost bias*를 만들어 prune을 어렵게 한다. 지금이 *가장 싸게* 줄일 수 있는 시점. 첫 사이클 1회 회고 후 prune이 두 번째로 싼 시점. 그 이후는 점점 비싸진다.

---

## 개선 경로 (Path Forward)

각 critical/high 반론에 대해 *해소되려면 무엇이 참이어야 하는가*.

### PF-1 (CA-1 해소 조건) — Operational layer 명시

다음 산출물이 추가되어야 함:
- *Loading policy*: 매 세션 시작 시 *항상* 로드되는 minimal core + *trigger-based* 추가 로드 룰 — 명시적 표로
- *Skill ↔ harness 진입 매핑*: 어떤 사용자 발화/skill 호출이 harness의 어느 부분을 활성화하는가 — `05-plugin-mapping.md`보다 한 단계 더 구체적인 *trigger → load → apply* 파이프라인
- *Token budget per turn*: 매 턴 harness 컨텍스트에 쓰는 토큰 상한 예산 (예: 3K)

### PF-2 (CA-2 해소 조건) — 진짜 enforcer 식별 + 구현

- 16개 hook spec 중 *coded enforcement가 가능한 4-5개*를 식별하고 *실제 구현*. Top 후보: `hook-hypothesis-immutability` (파일 + git pre-commit), `hook-cycle-wip` (active symlink check), `hook-deploy-kill-check`, `hook-l3-sunset-check`
- 나머지 12개는 *narrative reminder*임을 명시 — enforcer가 아니라 prompt임을 정직하게 라벨링
- 사용자에게 *외부 enforcer 채택 권유* 섹션: 공개 changelog, 사용자 인터뷰 약속, 학습공동체 — harness 밖이지만 work-around로

### PF-3 (CA-3 해소 조건) — Optimization이 아니라 *구조 재설계*

- Token "optimization" 대신 *3-tier 분리*:
  - Tier A — *항상 로드* (≤2K 토큰): minimal core invariants + 현재 stage 정보
  - Tier B — *trigger 로드* (≤5K 토큰): situational rules + 해당 stage rules
  - Tier C — *명시 요청 시* (∞): AP 카탈로그 전체, templates, 과거 사이클 retro
- 압축은 *그 다음* 작업. 지금 압축 시작하면 잘못된 모양을 압축하게 된다.

### PF-4 (CA-4 해소 조건) — 해시 체인을 narrative 가드로 보강

- 해시 체인은 *유지하되* (저렴함), 그 옆에 *가설 재해석 감지*를 둠: 회고 시 "원 가설 문구"와 "측정한 것 문구"를 *나란히* 표시하는 retro 템플릿 항목. *기억상*의 가설이 아니라 *원문*을 강제로 보게 만든다.

### PF-5 (CA-5 해소 조건) — 자기 채점에 *마찰* 추가

- Pre-cycle gate에 *48시간 대기*: Cycle Card 첫 작성 → 48시간 → 재읽기 → 채점. *현재의 흥분*과 *48시간 후 흥분*이 일치하면 통과.
- 또는 *AI를 calibrator로 등록*: 사용자 점수와 AI 점수가 0.3 이상 벌어지면 reconcile 강제. AI 점수에 *낮게 주는 기본 bias* 명시.

### PF-6 (CA-6 해소 조건) — Layer 단순화 검토

- 첫 사이클 *전까지* L1 User layer 도입 보류. L0 + L2 + L3로 시작. 두 사이클 후 L1 필요성 평가.
- Layer 결정에 *시간 메타데이터* 보강: 룰 frontmatter에 `set_at` + `last_reviewed` 추가. 6개월 미리뷰면 expire 후보로 표시.

### PF-7 (CA-7 해소 조건) — AP 카탈로그를 *체크리스트 30개*가 아니라 *분기 5개 rotation*으로

- 25-30개 AP를 *6개 카테고리 × 4-5개*로 유지하되, *분기마다 1개 카테고리만 active*. 분기 회고 시 그 5개만 점검.
- 나머지는 *trigger 발생 시*에만 활성화 (`situational-rules`와 동일 패턴).

---

## 다음 사이클을 위한 우선순위 (PF 순서)

| 순위 | 작업 | 차단 효과 |
|---|---|---|
| 1 | PF-1 Operational layer 명시 | 토큰 최적화의 *전제 조건* — 이게 없으면 다음 단계가 정의 안 됨 |
| 2 | PF-3 3-tier 구조 결정 | PF-1과 같이 진행. 압축 *전에* 구조 |
| 3 | PF-2 Hook 4-5개 실제 구현 | CA-2를 *물리적*으로 해결 — narrative만으로는 self-enforcement 안 됨 |
| 4 | PF-6 Layer 단순화 (L1 보류) | 첫 사이클 *전*에 가지치기. 늦으면 sunk cost |
| 5 | PF-5 48-hour gate 또는 AI calibrator | 실전 도입 시점에 |
| 6 | PF-7 AP rotation | 첫 회고 후 |
| 7 | PF-4 회고 narrative 가드 | 첫 회고 시 |

---

---

# Resolution log

PF-N이 충족되면 한 줄씩 append. 형식: `날짜 — PF-N — 증거 (commit / 파일 / decision)`.

- 2026-05-31 — **PF-1 (spec 충족)** — `13-operational-layer.md` 작성. §2 trigger→load→apply 파이프라인이 CA-1 빈칸을 닫음. *구현*은 §7 작업 목록으로 이연 (실전 1사이클 후).
- 2026-05-31 — **PF-3 (구조 결정 충족)** — `13 §1` 3-tier loading + `§5` prompt caching 정렬. CA-3의 "압축이 아니라 구조" 지적 반영 — 압축은 §7-1로 한정.
- 2026-05-31 — **CV-1 부분 대응** — `13 §4` Black box. 차단 대신 *기록 후 retro 대면*으로 author=enforcer=target 우회. invariant만 차단(§3), 나머지는 기록. *완전 해소 아님* — retro 대면을 실제로 하는지가 관건(신규 AP-31).
- 2026-05-31 — **PF-2 (경계 정의 충족, 구현 미정)** — `13 §3` rules-as-code 경계로 코드 강제 5개 식별. hook 실제 구현은 미정.
- 2026-05-31 — **CV-1 외부 grounding** — Böckeler "Harness Engineering for Coding Agents"가 우리 해법을 검증·정당화. 그녀 曰 *"인간은 harness가 대체 못 하는 organisational alignment를 제공하되, harness가 supervision toil을 줄인다."* → enforcer를 *사람→코드(Computational)*로 옮기되 판단(Inferential)은 사람. 우리 13 §3 경계가 정확히 이것. `00 §0.2b` 참조. **단 완전 해소 아님** — 차단하는 Computational Sensor가 *실제 wiring*돼야 효력 (현재 hash 등록만, cycle-001 F10). 다음 사이클 우선순위.
- 2026-05-31 — **사이클 #001 dogfood 완주** — `cycles/001-harness-plugin-mve/` 9개 산출물 + retro. 가설 H2(대화형 게이트) 부분 지지, H1(실사용)은 다음 프로젝트에서 측정 예약. 게이트가 solution-shopping(F1)·타입 편향(F2)·CLI 버그(F7)를 잡음 — 하네스가 *자기 자신에* 작동함을 실증.
- 2026-05-31 — **F6 SSOT 정리** — scripts가 `scripts/`(프로토타입) + `plugin/harness/scripts/`(복사본) 두 곳에 존재 → drift 위험. **결정: 플러그인이 canonical** (GOAL=설치형). draft `scripts/*.py` 4개 삭제, `scripts/README.md`는 포인터로 전환. 개념 문서의 `scripts/X.py` 참조는 *개념적 이름*으로 유지(실행본은 `${CLAUDE_PLUGIN_ROOT}/scripts/`). 근거: 단일 코드 SSOT > 참조 18개 재작성 churn.
- 2026-05-31 — **PF-2 첫 구현 + CV-1 물리 방어 첫 조각 (사이클 #002)** — `plugin/harness/hooks/hypothesis-immutability.py` — PreToolUse hook이 hypotheses.jsonl 직접 편집을 차단(exit2). Böckeler *Computational Sensor*의 첫 실제 wiring. self-test 5/5, false-positive 0, chain intact. **단 부분적** — PreToolUse는 *도구 호출*만 가로채므로 *세션 밖 편집*은 못 막음(cycle-002 F2). CV-1 완전 해소 아님 → SessionStart verify 짝 Sensor 필요. `cycles/20260531-hypothesis-immutability-sensor/` 참조.
- 2026-05-31 — **CV-1 짝 Sensor 완성 (사이클 #003)** — `plugin/harness/hooks/active-cycle-verify.py` — SessionStart hook이 active 사이클 chain을 verify해 *세션 밖 변조*를 탐지·경고. cycle-002 F2(PreToolUse 사각) 해소. self-test 3/3(intact/no-active/tampered). 이제 **차단(PreToolUse) + 탐지(SessionStart)** 짝으로 CV-1의 더 넓은 면 방어. *잔여*: 탐지는 하나 자동 복구 없음 → black box 대면에 의존. `cycles/20260531-sessionstart-verify-sensor/` 참조.
- 2026-05-31 — **kill-check 정직화 — 측정 가능성=강제 가능성 (사이클 #004)** — `kill-check.py`를 wall-clock→*작업 세션 카운트* 기반으로 재작성, `session-counter.py`(SessionStart) 추가로 session_count 자동 증가. CA-3("토큰 최적화가 틀린 타깃")의 사촌 문제 해소: kill-check가 *아무도 안 채우는* 필드를 읽어 항상-0(거짓 OK)였음. **budget$는 하네스가 관측 못 함 → kill 지표에서 드롭** — 측정 불가 지표로 강제하면 거짓말 Sensor. *"측정 가능한 것만 강제한다"* 원칙 확립(`13 §3` Computational/Inferential 경계의 직접 귀결). self-test 8/8. 큐 2번(deploy kill-check Sensor) 선행조건 해소 → #005 unblocked. *잔여*: reentry_count는 여전히 Inferential·수동(게이트 계측 필요). `cycles/20260531-metrics-honesty-session-count/` 참조.
- 2026-05-31 — **deploy kill-check Sensor 차단 wiring (사이클 #005)** — `plugin/harness/hooks/deploy-kill-check.py` — UserPromptSubmit hook이 deploy 키워드 감지 시 active 사이클에 kill-check를 돌려 **Hard kill이면 배포 프롬프트를 차단**(exit 2), Soft면 경고(차단 아님 — 재평가는 사람), 그 외 fail-open. `13 §3` "배포 → kill-check → Hard면 차단" 설계의 실제 wiring. C-06 Sunk-cost를 *물리적*으로 방어. self-test 7/7. **#004 선행 효과 실증** — metrics 정직화 없었으면 항상-ok 거짓 통과였을 것. 이제 **3 이벤트 Sensor**(PreToolUse 차단 + SessionStart 탐지·측정 + UserPromptSubmit 배포차단). *잔여*: 실제 설치 환경 통합 테스트 미실시(스키마 self-test만), deploy 키워드 오탐 수용. `cycles/20260531-deploy-kill-check-sensor/` 참조.
- 2026-05-31 — **바-잠금 — 품질 바 hash chain (사이클 #006, 품질저하방지 ①층)** — `chainlog.py`(공유 체인 SSOT) 추출 → `bar-register.py`가 품질 기준(gate임계/DoD/stage별 리뷰)을 `bar.jsonl`에 가설과 동일한 tamper-evident chain으로 등록 → `hypothesis-immutability.py` hook이 `bar.jsonl` 직접편집도 차단(exit2). **"지친 에이전트가 중간에 바를 낮추는"** 품질 저하 경로를 물리적 차단. **CV-1(author=enforcer=target)의 *품질판* 대응**의 1층 — 단 #006은 *바를 잠그는 것*까지고, 충족 강제는 #007(독립 리뷰 게이트)·#008(ratchet)이 `measure` 필드를 소비해야 완성(정직: #006 단독은 절반값). **dogfood 관측**: subagent 분산 실행에서 *독립 implementer가 orchestrator의 plan 버그(테스트 cd 깊이)를 잡고*, *quality 리뷰어가 latent KeyError를 잡음* → **#007 독립 리뷰의 가치를 사전 입증**(계획자도 틀린다는 직접 증거 — CV-1 완화의 실증). spec+quality 리뷰 4 chunk 전부 승인, self-test 전항목 PASS, 기존 가설 체인 회귀 0. *잔여*: `measure` 소비자 미구현(#007/#008), hook 파일명 rename 후보(이제 bar도 보호), 통합 테스트 미수행. `cycles/20260531-bar-lock/` 참조.
- 2026-06-01 — **독립 리뷰 게이트 — close-cycle 강제 (사이클 #007, 품질저하방지 ②층)** — `review-register.py`가 독립 리뷰 verdict를 `review.jsonl`에 가설/바와 동일한 `chainlog`로 append(`--criterion-id`로 잠긴 `bar_hash` 자동 결박) → `close-cycle.py`가 **유일 정당 종료 경로**가 되어 잠긴 바의 *모든* 기준에 그 hash에 결박된 `verdict=pass` 리뷰가 없으면 종료 거부(exit2, symlink 보존) → `active-symlink-guard.py` PreToolUse(Bash) hook이 수동 `rm cycles/active` 우회를 차단(Full Computational). `bar-register`는 중복 id 거부(바 낮추기 silent 경로 차단), `hypothesis-immutability`는 `review.jsonl`도 보호, `active-cycle-verify`는 bar·review 체인까지 verify(F5). **CV-1(author=enforcer=target)의 *품질판* ②층 — 생성/평가 분리(원칙3, Anthropic/OpenAI 하네스 설계)를 코드로 강제**. #006이 바를 *잠그는 것*까지였다면 #007은 그 충족을 *독립 리뷰로 강제*(measure 소비자 첫 구현). **dogfood 재귀 자기적용**: 리뷰 0건 close→차단(exit2)+symlink보존 *실측*, fresh subagent(doer≠reviewer)가 B1/B2/B3 채점(pass, 실증거)→close exit0+metrics closed *실측* → 게이트의 실제 작동을 재귀로 증명. self-test 5/5 PASS, 기존 체인 회귀 0. **정직한 한계 명문화**: ⓐfresh subagent는 *프로토콜이지 증명 아님*(코드가 독립성 증명 불가) ⓑ바 낮추기는 *불가능 아니라 가시화*(중복id 거부+hash불일치) ⓒguard는 Bash rm/unlink만(`mv`·`os.unlink`·후행슬래시 못잡음). *잔여*: dogfood 중 `test-close-cycle.sh` SKIP으로 close 런타임 증거 사각(retro 기록), 빌드를 subagent-driven 대신 직접 구현(독립 리뷰만 분리). `cycles/20260601-independent-review-gate/` 참조.
- 2026-06-02 — **cross-cycle ratchet — 품질 바닥 단조 비감소 (사이클 #008, 품질저하방지 ③층 = 3층 완성)** — `ratchetlib.py`(공유 순수함수, `chainlog.py` 규약대로 하이픈 없는 import 가능 파일)+`ratchet-check.py`(CLI check/floor/axes)가 *측정 가능한 축*(`axis`/`value`/`direction`)을 사이클을 넘어 비교 → `bar-register`에 **선택적** 축 메타 추가(축 없는 바는 키 0개라 해시가 pre-#008과 *비트 동일* = 하위호환) → `close-cycle.py` 게이트에 단계 2.5: 이번 cycle이 *선언한* 축이 이전 *닫힌* cycle의 watermark(=그 축에서 pass-리뷰 결박된 바 값의 best)보다 회귀하면 종료 거부(exit2, symlink 보존). **#006이 한 사이클 안 바 낮추기를, #007이 바 충족을, #008이 바가 사이클을 넘어 낮아지지 않음을 강제 → 품질저하방지 3층 완성**. **③층은 ②층 인프라에 무비용**: 새 hook 0개, 기존 `active-symlink-guard`가 수동 우회를 이미 차단. **오탐 0이 설계로**: `find_regressions`가 floor에 없는 축은 skip → 무관 영역 cycle은 축 미선언으로 자동 안전(false block 경로 없음). **dogfood 증거**: 자유텍스트 바엔 비교 단위가 없어 #008 자신은 수치 축이 없음(자기-재귀는 #007보다 약함, 정직히 인정) → 작동 증명은 **hermetic 합성 fixture**(tmp cwd, CASE1~7: 회귀70<80→exit2 · 동률80→exit0 · 개선90→exit0 · 미선언축→무차단 · direction뒤집기→차단 · close통합 회귀→exit2+symlink보존 · best-of 80추가→exit0)가 SSOT이며, 이 hermetic화가 **#007이 남긴 `test-close-cycle.sh` SKIP 사각까지 우회로 메움**. 독립 리뷰어(doer≠reviewer, 회의적 튜닝)가 6 self-test 직접 실행 + 코드 정독으로 B1~B4 전부 pass, **footgun 1건 포착**. self-test 6/6 PASS, 기존 체인 회귀 0. **정직한 한계**: ⓐ`best_declared`는 review-blind(타깃만 봄) — standalone `ratchet-check check` preview에선 미달성 high-value 바가 통과 가능하나, *통합 close*에선 #007이 모든 잠긴 바에 pass 리뷰를 강제하므로 메워짐(미래 재사용 시 footgun, backlog 등재) ⓑfloor의 direction은 last-best-wins(전역 검증 아님, edge) ⓒ실제 cross-cycle 차단은 같은 축 2회 등장하는 첫 실사용에서 관측해야(F4). `cycles/20260602-cross-cycle-ratchet/` 참조.
- 2026-06-02 — **packaging install onboarding — 설치 경로 개통 (사이클 #009, GOAL 앞단 ④)** — `harness-export.py`가 draft(source-of-truth)→top-level `./harness`(빌드 산출물, develop·think와 같은 레벨 peer)로 self-contained 플러그인을 빌드(컨셉 문서 00~13+situational-rules를 plugin 루트로 *평탄화*, `cycles/TODO/devils-advocate`는 dev 전용 제외, 안전거부+`.harness-export` 마커로 멱등) → `marketplace.json`에 `harness` peer 등록(source `./harness`, plugin.json v0.2.0) → `harness:install` 스킬이 대화로 L1 user-rules 생성(수동 작성이 기본 경로 아님, GOAL §3.2) → `user-rules-init.py`가 12-layering frontmatter로 멱등 생성(재-init 거부, `--force`는 .bak 백업, 중복 id 거부). **GOAL §3.1(install 가능성)·§3.2(interactive 초기화)를 코드로 충족**. 설계 결정(사용자): 산출물 top-level + draft=source. **게이트의 값 실증**: 게이트 D를 돌리다 *빌드 전에* self-containment 블로커(plugin이 컨셉 문서를 못 찾음) 포착 → 사이클 1순위가 marketplace 등록이 아니라 self-contained화로 재정렬. **독립 리뷰(원칙3)가 또 잠복 버그 2건 포착**: ⓐ`rules-load.py`가 실제 06-rules.md에서 룰 **0개** 파싱(헤더 H3 vs 정규식 H2 + per-rule Stage 가정 vs 섹션-단위 로딩시점 — *한 번도 동작 안 한 코드*, 패키징이 처음 노출) → 파서를 실제 구조로 재작성 + 테스트에 '>0 룰' non-vacuous 단언 추가, ⓑ빌더 `harness-export.py`가 export 산출물에 혼입(거기선 경로가 /home으로 깨짐) → EXCLUDE로 제외. self-test 8/8(신규 2: export hermetic smoke + user-rules 멱등), 기존 체인 회귀 0. **정직한 한계**: ⓐexport drift(컨셉 문서가 draft+./harness 두 곳, README/마커 경고로만 막음 — 자동 탐지 backlog) ⓑrules-load는 L0만 로드, L1/L2/L3 머지 엔진 미배선(install이 파일은 만드나 *적용*은 미완 — 정직 표기, 다음 키스톤) ⓒ실사용 유용성 H는 author=user라 미검증(CV-1, 새 머신 설치는 측정 대기) ⓓSendMessage 부재로 리뷰 후 수정의 재확인을 같은 리뷰어에 못 보냄 → 바 불변+non-vacuous 단언+전체 재실행(8/8)으로 갈음(무결성 경로 명시). `cycles/20260602-packaging-install-onboarding/` 참조.
- 2026-06-02 — **rule layering engine — L0+L1 머지로 L1 실제 적용 (사이클 #010, GOAL 앞단 ④-b)** — `ruleslib.py`(L0 06-rules.md 카탈로그 파서 + L1 per-rule 파서 + 머지 순수함수, chainlog/ratchetlib 규약대로 importable)+`rules-merge.py`(CLI effective/conflicts/layers)가 L0+L1을 stage별 우선순위(L1>L0 Default) 머지하고 effective rule마다 provenance(layer)를 붙인다. **#009 F4 해소 — install이 만든 L1 user-rules가 *실제 적용*된다**(install 스킬 Step3에 `rules-merge effective` 추가). 충돌 해소는 **declared layer로만**(§2, 해석 금지): 같은 id→높은 layer 승, 명시 `Overrides`, **invariant 보호**(낮은 invariant는 못 덮음 — 양 경로), 같은-layer 같은 id→자동선택 거부 exit2(AP-26). invariant 판정은 "(필수)" 섹션 마커=*선언된* 근거(추론 0). **MVE 경계를 사용자 결정으로 좁힘**: L0+L1만 + L1/L2/L3 포맷 1개 통일·L0 카탈로그 유지(churn 0, 45룰 재작성 안 함). **독립 리뷰(원칙3)가 값 갉는 갭 2건 포착**: ⓐstage 어휘 불일치(user-rules-init `Micro/Macro` vs L0 `code-writing/...`)로 생성 L1이 stage-filtered load에서 *전부 죽음* — unfiltered만 보면 안 보이는 #009 F8의 사촌 → emit stage를 L0 어휘로 정렬 + B4에 stage-생존 단언, ⓑWIP 룰이 기만적 no-op(거짓 `Overrides: R-PG01`, 한데 R-PG01은 "No code before design") → additive로 정직화. **머지 *실행*이 더 깊은 갭 노출(F4)**: "L1으로 L0 Default(WIP) override"를 실제로 돌리니 override 대상인 WIP=1 룰이 **06-rules.md에 코드화돼 있지 않다** — 12-layering §1 주장(L0 Default) vs 실제 코드의 갭을 엔진 실행이 드러냄. self-test 9/9, 기존 체인 회귀 0. **정직한 한계**: ⓐinvariant가 섹션-단위("(필수)")라 조잡 — per-rule scope 태깅 backlog(F3) ⓑstage 어휘 이원화는 증상만 막음, 근본 SSOT는 backlog(F1) ⓒL0 Default 룰(WIP·14일) 미코드화 backlog(F4) ⓓconflicts는 same_layer_dup만 exit2, 나머지 비차단 충돌은 stdout만(F5) ⓔL0 파서가 rules-load와 중복(R-CD04 Rule-of-Three 전 의도적 WET) ⓕSendMessage 부재로 수정 재확인 못 보냄 → 바 불변+B4 단언 강화+9/9 재실행으로 갈음. `cycles/20260602-rule-layering-engine/` 참조.

---

# Severity revision

기존 CA의 severity 변경 기록. 형식: `날짜 — CA-N: old → new (사유)`.

*(아직 비어 있음)*

---

# Review #2 — *(템플릿, 사용 시 복사)*

```
## Review #N — YYYY-MM-DD (target state)

**대상**: [무엇을 평가하는가 — 구체적 파일/구조 명시]
**단계**: [현재 진행 단계]
**Goal 기준**: GOAL.md §N (이번 review가 비추는 Goal 절)
**이전 review와의 관계**: [무엇이 바뀌었나 / 어떤 PF-N 해소를 검증하나]

## 숨은 가정 (HA-N부터 이어서)
...

## 반론 (CA-N부터 이어서)
...

## 핵심 취약점 (CV-N부터 이어서, 있다면)
...

## 가역성
...

## 개선 경로 (PF-N부터 이어서)
...
```

