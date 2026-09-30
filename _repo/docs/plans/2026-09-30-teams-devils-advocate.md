# teams: devil's advocate — 문제점과 나아갈 방향

> 2026-09-30, `think:devils-advocate`. 기준 버전 teams 0.38.0 (`f2f600e`).
> 근거: `_repo/docs/plans/2026-09-21-teams-server-owns-the-loop.md` §8b–§8g, `2026-09-28-teams-cards-everywhere.md`,
> `2026-09-28-teams-long-loop.md`, `teams/CHANGELOG.md`, `teams/README.md`.
> 이 문서는 비판이다. 결정 기록이 아니며 어떤 원칙도 바꾸지 않는다.

## 입장

- **Position:** teams는 요청을 소규모 팀처럼 처리한다. 기획 카드 → 개발 패키지 → QA 카드, 모든 카드가 6단계 하네스.
- **Steel-man:** 한 세션에 안 담기는 L급 요청을 사람 없이 끝까지 끌고 가고, 모든 산출물을 작성자 아닌 쪽이 실행으로 검증한다.
  목표는 "plain보다 싸다"가 아니라 기획·QA 하네스, 그 오케스트레이션, 태스크 관리를 갖추는 것이다(09-22 재정의, §8g).

## 숨은 가정

1. 단계·gate가 많을수록 납품물 결함이 준다.
2. 원칙을 먼저 확정하고 측정은 나중에 따라와도 된다.
3. 좁은 컨텍스트의 카드로 쪼개도 전체 일관성이 유지된다.

## 반론 1 — 목표가 "결과"가 아니라 "구성요소 보유"라서 반증이 불가능하다 · assumption · critical

결과를 가른 측정은 두 번이고, 둘 다 teams가 이기지 못했다.

| 케이스 | plain | teams | 사후 감사 결함 |
|---|---|---|---|
| seam-silent (§8b–c) | $0.91 / 3분 | $9.58 / 57분 | 0 / 0 |
| trap (§8f) | $2.88 / 12분, 14/14 | $30.41 / 114분, 14/14 | major 1 / 같은 major 1 |

teams gate가 잡은 결함은 대부분 teams 구조(brief만 받은 좁은 컨텍스트 구현자)가 만든 것이다.
09-22 목표 재정의로 §8f의 "엔진 보류"는 새 데이터 없이 철회됐다. 이후 planning/QA 기본 on(0.17),
카드마다 full harness(C1), `planning:false` 거부(C5), sub-EPIC 제거, S 경로(0.38)가 실측 없이 출하됐다.
0.26.1 시점 QA 하네스 실측 0회. 0.37.x–0.38 CHANGELOG에 기능 검증 실측 기록 없음.

선례: Brooks의 second-system effect.

## 반론 2 — "고정 원칙"이 측정보다 빨리 바뀌고, 권위 문서가 이미 틀려 있다 · execution · high

- 0.14 chain-only 자식 런(실측으로 8→3 노드) → 09-28 C1에서 되돌림.
- C6 "S도 기획 카드"(09-28) → 하루 뒤 0.38에서 S에 한해 철회.
- README 자기모순: 다이어그램은 S → planning card → QA card, 표는 S에 둘 다 없다고 적는다.
- `CLAUDE.md`가 지정한 권위 문서 `2026-09-28-teams-cards-everywhere.md`에 C6와 "Any task, any size: `10-prd.md`"가
  완료 기준으로 남아 있다. 철회는 long-loop 문서에만 있다.
- 09-17 이후 13일간 teams 커밋 271개.

하루 단위로 바뀌는 원칙은 가설이다. 그런데 가설로서 요구될 측정이 붙어 있지 않다.

선례: 뚜렷한 외부 선례 없음 — 추측성 우려(근거는 repo 안).

## 반론 3 — 프랙탈 6단계가 비용과 결함원을 곱한다 · structural · high

카드 수(기획 영역 × 패키지 × QA 영역)마다 plan·setgoal·critique·gate·report와 judge 호출이 붙는다.
CHANGELOG 106개 항목 대부분은 오케스트레이션 자체 결함 수정이다(false `blocked`, 좀비 드라이버, 재판정 대기,
capacity 주차, reshape 뒤 도달 불가 deps). `taskmanager` 한 파일 7,207줄.
trap에서 accept가 약한 SIGKILL 테스트를 정확히 지적했지만 최종 납품물엔 그대로 남았다 —
검증이 늘자 "검증이 본 것"과 "납품된 것"이 갈라졌다.

선례: Segment 2018 "Goodbye Microservices" — 규모 대비 과분할, 조정 비용이 분리 이득을 넘어서 재통합.

## 핵심 취약점

가정 1·2가 합쳐진 **단방향 래칫**. 목표가 "단계를 갖추는 것"이므로 빼면 목표 위반, 더하는 데는 측정이 필요 없다.
`CLAUDE.md`의 "Never remove a stage, a gate, or a principle for cost or simplicity"가 이를 명문화한다.
비용은 오르기만 하고, 제거를 제안할 근거는 구조적으로 생기지 않는다. 반론 1–3은 이 구조의 증상이다.

## 가역성

**reversible** — 0.x, 로컬 플러그인, git. 다만 원칙 고정·테스트 변환·legacy 동결 경로(S2 `s_run` 읽기 분기)가
쌓일수록 one-way door에 가까워진다. 지금이 논쟁보다 측정할 때다.

## 개선 경로

1. **역할별 결과 지표.** 예: QA = "사후 감사 결함 중 QA 카드가 빌드 안에서 먼저 잡은 비율". 0.38로 trap P1/Q1 실측.
2. **엔진 vs gate.** §8f가 제안하고 안 돌린 비교: "plain이 만들고 적대적 실행 gate가 깬다" 얇은 층 vs 전체 엔진,
   같은 trap/seam-silent, 같은 감사자.
3. **원칙 동결.** L급 실측 1회 완주 전까지 원칙 변경 중지. README S 다이어그램 수정, cards-everywhere C6에 superseded 주석.
4. **래칫 해제(사용자 결정).** "never remove" → "N회 실측에서 catch 0인 단계는 증거와 함께 제거를 제안할 수 있다". 승인은 그대로.

## 페르소나별 의견

서브에이전트 4개(Sonnet)가 각각 `think:devils-advocate`로 본문과 겹치지 않는 반론을 냈다.
핵심 사실은 스폿체크함(drivercost import, `budget_usd` 기본 null, README:9-11, `s_run` 분기 52곳).

### SRE / 운영자 — 핵심: 무인 실행에 감독 계층이 없다

1. **데몬 부활이 pull 방식이다 · structural · high.** 재기동(`serviceDaemon`)은 `tm_*` 호출 경로에서만 일어난다
   (`taskmanager:4977,7119,7131`). `run` 폴러와 데몬이 함께 죽으면 아무도 살리지 않는다. `daemon_exhausted`는
   ledger 기록뿐 상태·알림 전환이 없다. `caffeinate`는 bench `drive.sh`에만 있다(0.28.x 절전으로 5시간 손실).
2. **예산 상한이 기본 무제한이고 사후 집계다 · execution · high.** `budget_usd` 기본 `null`(`configuration.md:62`),
   세션 비용은 끝나야 잡힌다. $25→$28.26(0.36.0), $40→$61.77(0.37.1).
3. **false-green 상태가 반복 출하됐다 · execution · medium.** QA 안 돈 런이 `complete`(0.36.0 이전), 16h+ `running` 좀비(0.30.0),
   예산 정지 후 상태 문자열 불변(0.37.1→0.37.2). 0.38 S 경로도 실측 없이 run 파일에서 `complete`를 유도한다.

본문 반론 2(커밋 271개)에는 반대: 운영 관점에선 롤백 가능한 변화율이라 방어된다.
경로: 데몬 heartbeat + 사망/`daemon_exhausted`를 `blocked`·exit code로 승격, `run`을 `caffeinate`로 감싸기, 스트림 증분 비용 집계.

### CFO / 예산 책임자 — 핵심: "납품 결과 1건당 $"가 어디에도 집계되지 않는다

1. **budget box는 상한이 아니라 경보다 · execution · high.** 위 초과 사례 + $15 box 중 $14.85를 planning에 소진(0.31.7),
   95% 지점에 audit이 열려 정지 후 +$5.14(0.31.9). 수정은 관측된 경로만 막는다.
2. **지출이 오케스트레이션 결함 재현에 나간다 · assumption · high.** 벤치 시드 30개 $419.50(0.32.2), 측정 도구 자체가
   $41.39 누락·$66.62 중복 집계한 이력. 0.38 S 경로의 $ 실측 없음. 본문의 "측정하라"도 지출을 늘리니 측정 예산 상한과 중단 기준이 먼저다.

경로: dispatch kill 기반 하드 캡 + "box 초과율" 회귀 테스트(grace 10% 또는 5분), `harvest`에 accepted 결과당 $ 열과 월 벤치 상한.

### 신규 채택자 — 핵심: "무엇을 하는가"만 있고 "언제, 얼마에"가 없다

1. **선택 기준에 harness·plain이 없고 비용·시간 기대치가 없다 · assumption · critical.** 비교표(README:17-23)는 graph vs teams뿐.
   실측($2.88/12분 vs $30.41/114분)은 채택자가 읽는 문서에 없다. 기본 무제한 예산 + codex 비용 미집계.
2. **첫 문단이 S에 대해 거짓이다 · execution · high.** README/KOR:9-11 "every task, of any size, gets a PRD" vs :106 S는 기획 카드 없음.
3. **노브·스킬 안내가 정독형이다 · execution · medium.** `configuration.md:7`이 스스로 "코드보다 오래됨", marketplace 설명에 0.38 S 경로 없음,
   `orchestrate` 트리거가 "그래프 돌려줘", 노브 20여 개에 우선순위 표시 없음.

경로: README 상단 "언제 teams 말고 plain/harness/graph" 표 + 실측 비용·시간 한 줄, README/KOR:9-11 수정, 무제한 예산 경고.

### 미래 유지보수자 — 핵심: "왜 그런지"의 단일 출처가 없다

1. **현재 규칙을 알려면 플랜 문서 17개(8,218줄)를 읽어야 한다 · structural · high.** 철회 표기가 머리글·인라인·취소선으로 제각각,
   `2026-09-17-teams-team.md:699`와 :816이 서로 정정. `marketplace.json:141`과 `plugin.json:3`의 설명이 갈라짐.
2. **동결 경로와 하네스 결합이 한 파일에 흩어져 있다 · structural · high.** `taskmanager` 7,207줄에 `s_run` 분기 52곳, `harness_run` 26곳,
   `:1529`에서 신·구 경로가 한 조건문. `harnessrun`이 `.harness-run/broker/runs/<id>.json` 레이아웃을 버전 확인 없이 하드코딩 —
   harness가 바꾸면 S verdict를 조용히 못 읽는다. 런타임이 벤치 코드를 import(`taskmanager:106` → `scripts/bench/lib/drivercost`).

경로: `_repo/docs/plans/` 현재 규칙 한 장(CURRENT.md) + 낡은 문서 상단 포인터 통일, `s_run` 읽기를 legacy 모듈로 추출,
harness 레이아웃 버전 체크 + 계약 테스트, `drivercost`를 `mcp/`로 이동.

## 종합

| 페르소나 | 가장 무거운 한 가지 | 본문과의 관계 |
|---|---|---|
| SRE | 복구가 전부 pull — 호출이 끊기면 정상과 죽음이 구별 안 됨 | 새 축(감독 계층). 반론 2에는 반대 |
| CFO | 예산 box가 상한이 아니라 경보 | 반론 1·3의 비용 측면을 "통제 실패"로 구체화 |
| 채택자 | 비용·시간·대안 조건이 문서에 없음, 첫 문단이 거짓 | 반론 2의 문서 모순을 채택 판단 지점으로 확장 |
| 유지보수자 | 규칙의 단일 출처 없음, harness 파일 포맷 결합 | 반론 2(원칙 변경 속도)가 만든 문서 부채의 이자 |

**공통으로 수렴한 것:**
- **예산 기본 무제한 + 사후 집계.** 세 페르소나(SRE·CFO·채택자)가 독립적으로 지목했다. 가장 싸고 가장 확실한 수정이다.
- **문서가 동작을 따라가지 못한다.** 채택자·유지보수자·본문이 같은 S 모순을 각자 다른 위치에서 발견했다.

**우선순위(제안):**
1. 즉시(doc fix, 설계 절차 불필요): README/KOR:9-11과 S 다이어그램, cards-everywhere C6 superseded 주석, marketplace 설명 동기화.
2. 설계 절차 필요(plan→setgoal→critique→승인): 예산 하드 캡과 무제한 경고, 데몬 heartbeat와 사망 상태 승격, harness 레이아웃 계약 테스트.

> **정정 (2026-09-30, 사용자):** 사용자는 비용이 들어도 완성된 결과를 원한다. 예산 하드 캡은 기본값으로 두지 않고, 기본 무제한을 유지한다.
> 막을 대상은 지출이 아니라 **낭비**(같은 실패의 반복)다. 실행 범위는 `2026-09-30-teams-direction-plan.md`(축소판)를 따른다.
3. 측정(비용 발생, 상한 먼저): 본문 개선 경로 1·2 — trap P1/Q1, 엔진 vs 얇은 gate.
4. 구조 정리(급하지 않음): CURRENT.md, `s_run` legacy 추출, `drivercost` 이동.
