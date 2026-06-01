# Harness Engineering — TODO

> 사이클 retro 큐 + devils-advocate 잔여 + dogfood findings 백로그를 한 곳에 모음.
> 우선순위 정렬. 사이클 종료 시 여기 갱신. SSOT는 각 `cycles/<id>/retro.md`이고, 이 파일은 *집계 뷰*.
> 관련: [GOAL.md](./GOAL.md) · [devils-advocate.md](./devils-advocate.md) (취약점 누적 로그)

마지막 갱신: 2026-06-01 (사이클 #007 종료 직후)

> **북극성 재정의**: Claude 품질의 *사이클별 저하*를 **구조적으로** 막는다. 3층 = ①바-잠금(#006 ✅) ②독립 리뷰 게이트(#007 ✅) ③ratchet(#008). 그 다음에 ④install/룰엔진(packaging).

---

## 🔜 Now — 다음 사이클 후보 (품질저하방지 우선)

- [ ] **#008 ratchet** (품질저하방지 ③층 — 키스톤) — 품질 지표 사이클 간 단조증가, 공통 축 회귀 시 차단. #007이 *바 충족*을 강제했다면 #008은 *바가 사이클을 넘어 낮아지지 않음*을 강제(cross-cycle 회귀 게이트). `bar.jsonl`의 `measure` + `review.jsonl` verdict를 이전 사이클과 비교.

## 🧱 Backlog — 구조/계측 (별도 사이클 필요)

- [ ] **GOAL 앞단 — 설치/온보딩 경로** (GOAL.md §2 1~4단계) — packaging. 품질저하방지 3층 후로 이연.
  - [ ] marketplace.json에 `harness` 플러그인 등록 + `<plugin>/README.md`
  - [ ] `harness:install` 온보딩 skill — interactive
  - [ ] interactive **L1 user-rule** 설정 (`~/.harness/user-rules.md`) → `12-rule-layering.md`
- [ ] **hook 파일명 rename** (#006 F3) — `hypothesis-immutability.py`가 이제 `bar.jsonl`·`review.jsonl`도 보호 → 이름 좁음. hooks.json wired라 신중히.

- [ ] **reentry 자동화** (#004 F3) — `reentry_count`는 아직 Inferential·수동. 게이트 단계 재진입을 *계측*해야 자동화 (SessionStart로는 못 잡음).
- [ ] **08-pass-criteria 타입별 Gate 변형** (#001 F9) — Product/Dev-tool/Exploration 별 Gate 기준. `09 §9.1b`는 했고 `08`은 미반영.
- [ ] **pivot-triggers 위치 결정** (#001 F8) — cycle-card 인라인 vs 별도 파일.
- [ ] **tampered 후 자동 복구/롤백** (#003 의심) — 현재 *탐지*만, 복구 수동. black box 대면에 의존. (자동 롤백은 과할 수 있음 — 판단 필요)
- [ ] **13 §7 나머지 최적화** — tier-A 압축, prompt 캐싱 정렬 실측, 미구현 hook들 (16개 spec 중 일부).
- [ ] **hook 통합 테스트** (#005 의심) — 실제 `claude` 플러그인 설치 환경에서 Sensor 3종 end-to-end. 현재는 스키마 self-test만.

## 🔬 측정 대기 — 외부 트리거 필요 (지금 빌드 불가)

- [ ] **H1 측정** (#001 인계) — *다음 실제 프로젝트*에서 `harness:cycle`이 실제 호출되는지 black box 기록. dogfood(author=user)로는 측정 불가 — CV-1 편향. GOAL 앞단 완성 + 새 프로젝트 착수가 선행.

## 🩹 Watch — 잔여 위험 (devils-advocate)

- [ ] **AP-31 검증** — black box retro 대면을 *실제로 하는지*. CV-1 완전 해소의 관건. 매 사이클 retro의 "어긴 룰" 절로 추적 중.
- [ ] **appetite_sessions 정확도** (#004 의심) — 사람이 틀리게 설정하면 kill 오발동. Inferential 입력 의존.
- [ ] **모델 교체 시 하네스 재검증** (원칙5, Anthropic) — 하네스 구성요소는 "모델이 못하는 것"에 대한 가정. 모델 버전이 오르면 주요 태스크 3개로 전/후 비교 → 불필요해진 Sensor/Guard 제거, 새로 가능해진 영역으로 확장. (지금은 Watch — 다음 모델 업글이 트리거)

---

## ✅ Done — 완료 사이클 (집계)

- [x] **#001** harness-plugin-MVE — 설치 가능 상태까지. 게이트 자기적용 실증. `cycles/001-harness-plugin-mve/`
- [x] **#002** hypothesis-immutability Sensor — PreToolUse 차단(세션 내). `cycles/20260531-hypothesis-immutability-sensor/`
- [x] **#003** active-cycle-verify Sensor — SessionStart 탐지(세션 밖). #002 F2 해소. `cycles/20260531-sessionstart-verify-sensor/`
- [x] **#004** metrics 정직화 — session-count kill-check + session-counter hook. budget$ 드롭. "측정 가능성=강제 가능성". `cycles/20260531-metrics-honesty-session-count/`
- [x] **#005** deploy kill-check Sensor — UserPromptSubmit hook, Hard kill이면 배포 차단(exit2). 3 이벤트 Sensor 완성. `cycles/20260531-deploy-kill-check-sensor/`
- [x] **#006** 바-잠금 — `chainlog.py` 추출 + `bar-register.py`(품질 바 hash chain) + hook이 `bar.jsonl` 보호. 품질저하방지 ①층. dogfood가 독립 리뷰 효과 입증(plan 버그·latent KeyError 잡힘). `cycles/20260531-bar-lock/`
- [x] **#007** 독립 리뷰 게이트 — `review-register.py`(review.jsonl chain, bar-hash 결박) + `close-cycle.py`(유일 종료 경로, 바 전 기준 pass 리뷰 없으면 차단) + `active-symlink-guard.py`(수동 rm 차단) + bar dup-id 거부 + F5(bar·review verify). 품질저하방지 ②층. **원칙3(생성/평가 분리) 코드 강제**. dogfood가 게이트 작동 재귀 증명. `cycles/20260601-independent-review-gate/`
- [x] SSOT 정리 (#001 F6) — 플러그인이 canonical, draft scripts 삭제.
- [x] Böckeler "Harness Engineering" grounding (`00 §0.2b`) — CV-1 외부 검증.

---

## 💰 토큰 최적화 (맨 마지막 — 구조 안정화 후)

- [ ] **토큰 최적화 패스** — 품질저하방지 3층(#006~#008) 완성 후 착수. *구조가 굳기 전에 최적화하면 잘못된 타깃을 깎는다* (CA-3: "압축이 아니라 *모양* 자체가 무거움").
  - [ ] **tier-A 룰 압축** — SessionStart 주입분(effective rules) 최소화. `13 §7-1`.
  - [ ] **prompt 캐싱 정렬 실측** — 정적/동적 경계로 캐시 히트율 측정 (`13 §5`). 5분 TTL 고려.
  - [ ] **컨텍스트 윈도 예산** — 사이클당 주입되는 문서/메트릭/룰의 토큰 측정 → 임계 초과 시 경고 Sensor 검토.
  - [ ] **측정 먼저, 압축 나중** — 추측 압축 금지. 실측 토큰 프로파일 없이는 손대지 않는다 ("측정 가능성=강제 가능성" #004의 연장).




## 📚 Reference — 하네스 설계 7원칙 (Anthropic/OpenAI 글에서 추출)

> 원칙2(불변량 코드 강제) → #006 바-잠금. 원칙3(생성/평가 분리) → #007 독립 리뷰 게이트. 원칙5(모델 교체 시 재검증) → 위 Watch 항목.

- https://www.anthropic.com/engineering/harness-design-long-running-apps
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://www.anthropic.com/research/building-effective-agents
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://openai.com/index/unlocking-the-codex-harness/
- https://openai.com/index/harness-engineering/
- https://ghuntley.com/loop/
- https://goddaehee.tistory.com/565

6. 실무 적용: 하네스 설계 7원칙
두 글에서 추출한 실무 원칙을 정리한다.

원칙 1: 지도를 주지, 백과사전을 주지 마라
AGENTS.md / CLAUDE.md는 100줄 이내의 "목차"로 유지하고, 상세 내용은 docs/ 하위에 구조화한다. Progressive Disclosure로 에이전트가 필요할 때 깊이 탐색하게 한다. (OpenAI)
▶ 시작점 AGENTS.md 파일을 열고 100줄 넘는 부분을 확인한다. 넘는다면 해당 내용을 docs/ 디렉토리로 분리하고, AGENTS.md에는 해당 파일로의 링크만 남긴다.


원칙 2: 불변량은 코드로 강제하라
아키텍처 경계, 의존성 방향, 네이밍 규칙은 문서가 아닌 린터와 CI로 강제한다. 린터 에러 메시지에 수정 방법을 포함시켜 에이전트가 바로 고칠 수 있게 한다. (OpenAI)
▶ 시작점 레이어 경계 위반을 감지하는 린터 규칙 1개만 추가한다. (예: UI 컴포넌트에서 직접 DB 접근 금지). CI에 연결해서 에이전트가 생성한 코드에도 즉시 적용되게 한다.


원칙 3: 생성과 평가를 분리하라
에이전트에게 자기 작업을 평가하라고 하면 편향이 생긴다. 독립된 Evaluator를 두고, 그 Evaluator를 "회의적(skeptical)"으로 튜닝하는 것이 Generator를 자기 비판적으로 만드는 것보다 훨씬 쉽다. (Anthropic)
▶ 시작점 다음 PR 리뷰를 에이전트에게 맡길 때, 코드를 작성한 인스턴스와 다른 독립 인스턴스에 "이 PR의 문제점만 찾아라. 좋은 점은 생략해도 좋다"는 회의적 프롬프트로 리뷰를 요청해본다.


원칙 4: 에이전트에게 앱을 "보여줘라"
Chrome DevTools Protocol, Playwright MCP, 로컬 관측성 스택(로그/메트릭/트레이스)을 에이전트에 연결하여, 에이전트가 실행 중인 앱을 직접 구동하고 검증할 수 있게 한다. (OpenAI + Anthropic 공통)
▶ 시작점 에이전트에게 새 기능을 구현하게 하기 전에, 먼저 "로컬에서 앱을 실행하고 현재 동작을 스크린샷으로 캡처한 뒤 알려달라"고 요청해본다.


원칙 5: 모델이 바뀌면 하네스를 재검증하라
하네스의 모든 구성 요소는 "모델이 못하는 것"에 대한 가정이다. 새 모델이 나오면 한 번에 하나씩 제거하며 여전히 필요한지 검증한다. 필요 없는 구성은 제거하고, 새로 가능해진 영역에 하네스를 확장한다. (Anthropic)
▶ 시작점 모델 버전이 올라갈 때마다 주요 에이전트 작업 3개를 선정해 이전/이후 결과를 비교한다. 예상보다 더 잘 되거나 더 안 되는 태스크가 있으면 하네스 조정 신호다.


원칙 6: 엔트로피를 가비지 컬렉션하라
에이전트 생성 코드는 시간이 지나면 반드시 드리프트한다. "golden principles"를 정의하고, 정기적으로 스캔 → 리팩토링 PR을 여는 백그라운드 프로세스를 만든다. 기술 부채는 소량씩 계속 갚는 것이 한꺼번에 처리하는 것보다 낫다. (OpenAI)
▶ 시작점 월 1회 에이전트에게 "이 리포지토리에서 더 이상 참조되지 않는 파일, 죽은 코드, 미사용 의존성 목록을 작성해달라"고 요청한다. 가비지 컬렉션의 시작점이다.


원칙 7: "지루한" 기술을 선택하라
"Boring" 기술(안정적 API, 높은 조합성, 훈련 데이터에 풍부)이 에이전트에게 더 쉽다. 때로는 외부 라이브러리를 쓰는 것보다 에이전트가 하위 기능을 직접 구현하게 하는 것이 더 낫다 — 100% 테스트 커버리지와 런타임 기대에 정확히 맞출 수 있으므로. (OpenAI)
▶ 시작점 다음 아키텍처 결정 시 새로운 프레임워크 대신 에이전트가 학습 데이터로 가장 많이 봤을 기술(PostgreSQL, FastAPI, React, Spring Boot 등)을 먼저 검토한다. 혁신은 비즈니스 로직에서 하고, 인프라는 boring하게 유지한다.

 


