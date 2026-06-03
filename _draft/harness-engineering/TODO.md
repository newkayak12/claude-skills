# Harness Engineering — TODO

> 사이클 retro 큐 + devils-advocate 잔여 + dogfood findings 백로그를 한 곳에 모음.
> 우선순위 정렬. 사이클 종료 시 여기 갱신. SSOT는 각 `cycles/<id>/retro.md`이고, 이 파일은 *집계 뷰*.
> 관련: [GOAL.md](./GOAL.md) · [devils-advocate.md](./devils-advocate.md) (취약점 누적 로그)

마지막 갱신: 2026-06-02 (#011 종료 + dry-run 마찰수정 + Now 순서 반전: 룰 자동주입 → 토큰 경량화)

> **북극성 재정의**: Claude 품질의 *사이클별 저하*를 **구조적으로** 막는다. 3층 = ①바-잠금(#006 ✅) ②독립 리뷰 게이트(#007 ✅) ③ratchet(#008 ✅). **품질저하방지 3층 완성**. ④ packaging/install — #009 설치 경로 개통 + #010 룰-레이어링 엔진(L0+L1 머지·provenance·invariant 보호). install이 만든 L1이 *실제 적용*됨. 다음은 ④-c L2 project-rules + L0 Default 룰 코드화(#010 F4).

---

## 🔜 Now — 다음 사이클 후보 (룰 자동주입 → 토큰 경량화 → L2)

> **순서 갱신(2026-06-02, 사용자 "룰 자동주입 후에 토큰 최적화하자")**: 경량화↔자동주입 순서 *반전*. 이유: 자동주입을 먼저 깔아야 *실제 컨텍스트에 들어가는 토큰*이 생긴다 → 그 **실측치**를 깎는 게 맞는 타깃("측정 먼저, 압축 나중" #004 연장). 미주입 상태의 추정 토큰을 미리 깎는 건 잘못된 타깃. 부수효과: 자동주입은 H1(하네스가 *실제로* 작동·룰이 컨텍스트 도달)을 처음 건드리는 층 — 시뮬이 못 닿은 호출/주입 규율층.

- [ ] **룰 자동 injection** (#010 잔여 · **키스톤**) — `rules-merge` effective 룰을 SessionStart(또는 stage 진입) hook이 컨텍스트에 **자동 주입**. 단 **stage-aware·최소로**(전부 주입은 토큰 폭증 — 그래서 경량화가 *뒤*에 붙어 실측 깎기). 주의: *주입 ≠ 강제* — soft/Inferential 끝이고, 진짜 강제는 게이트·hook(원칙2). 지금은 사람이 `rules-merge` 돌려 읽는 반자동.
  - [ ] 이 사이클에서 **`install` SKILL.md Step3 갱신** — "작업 단계별" 행을 *수동 명령 → hook 자동 주입*으로. (install 변경은 자동주입의 다운스트림 — 지금 install은 반자동을 정직히 기술해 일관됨)
- [~] **토큰 경량화** (💰 상세 아래 — **2026-06-03: lossless 압축분 완료, 슬라이싱은 stage-injection 후속으로 분리**) — 실측 rule-inject 매 세션 766토큰(45룰). **달성: 포맷 1줄/룰 압축 766→620(≈19%↓), 룰 누락 0(lossless)**. 더 큰 win(코딩 룰을 코딩 단계에만)은 정적 default 슬라이싱이 필요한데, 독립 리뷰가 "단계 자동 재주입 없으면 코딩 세션에 코딩 룰 누락 = 기능저해"로 반려 → **🎯 stage-injection 별도 사이클**(💰 하단). **제약(사용자): 기능 저해 금지** 준수.
  - [ ] **GC 표면 확장** (#011 F4 — GC 첫 패스가 얕음, high 4건=1 root cause) — `gc-scan`을 plugin SKILL.md 링크·문서 토큰 비대·미사용 hook spec(hooks/README의 11개 unbuilt)까지 확장. GP-2 스캔 범위에 plugin/ 포함 검토(해석 맥락 차이 주의).
  - [ ] **의미적 stale 탐지** (#011 F1·F2) — "문서 주장 vs 코드 현실"(hooks/README "전부 미구현"인데 5개 구현 류)은 결정론 스캔이 못 잡음. GC 의식의 *mandatory 사람/LLM 내용검토* 단계로 명문화(gc.md §6.4 표면판). GP-1 watch의 실용가치도 이때 검증(0/2 정밀도였으니).
- [ ] **L2 project-rules 합의 흐름** (GOAL §2 step 4) — `cycle-init.py` 첫 실행 시 `<project>/.harness/project-rules.md` scaffold + 합의 절차. ruleslib에 L2 로드 추가(우선순위 L2>L1>L0), cross-file dup 탐지(#010 F6).
- [ ] **L0 Default 룰 코드화** (#010 F4) — 스펙(12-layering §1)이 L0 Default라는 WIP=1·14일 상한이 06-rules.md에 *룰로 없음*. 코드화해야 L1 override가 대상을 갖는다. + per-rule scope 태깅(#010 F3, §4의 5개 Core를 id로 고정).
- [ ] **stage 어휘 SSOT** (#010 F1 잔여) — 12-layering §3(Macro/Micro) vs 06-rules §0.1(code-writing/...) 이원화. 한 어휘로 수렴 또는 매핑표. 지금은 user-rules-init을 §0.1로 정렬해 증상만 막음.
- [ ] **export drift 자동 탐지** (#009 F5) — draft(source)↔`./harness`(산출물) 해시 비교 hook/CI. 지금은 README/마커 경고뿐.

## 🧱 Backlog — 구조/계측 (별도 사이클 필요)

### 미구현 원칙 (Anthropic/OpenAI 7원칙)
- [x] **엔트로피 GC** (원칙6) — **#011 완료**. `gc-scan.py`+`GOLDEN-PRINCIPLES.md`+ratchet 축 2개. *표면* GC(죽은 링크·stale 문서·relic). 잔여: 토큰판(위 Now)·의미적 stale(F2).
- [ ] **앱을 보여줘라 + 관측성** (원칙4) — 에이전트가 *실행 중인 앱을 직접 구동·검증*하는 경로가 없음. 하네스가 BE 지향이라 빠졌으나 추가 필요(사용자 확인). BE판: 로그/메트릭/트레이스 관측 스택 연결(에이전트가 실행→관측→검증). FE판 CDP/Playwright MCP는 그 다음. "기능 구현 전 현재 동작을 먼저 관측"이 시작점.

### 기타
- [ ] **ratchet `best_declared` review-blind footgun** (#008 의심) — `best_declared`는 리뷰 무관(타깃만). standalone `ratchet-check check` preview에선 미달성 high-value 바가 통과 가능. *통합 close*에선 #007이 메우나, `best_declared`를 미래 코드가 "achieved" SSOT로 재사용 시 위험. → devils-advocate 등재.
- [ ] **cycle-init cwd 강건성** (#008 F1) — `plugin/harness/`에서 돌리면 엉뚱한 위치에 cycles/ 생성. repo 루트 마커 탐색으로 보강.
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
- [x] **#008** cross-cycle ratchet — `ratchetlib.py`(공유 lib)+`ratchet-check.py`(CLI)+`bar-register` 선택적 축(axis/value/direction, 하위호환)+`close-cycle` 게이트 2.5(선언 축이 이전 닫힌 cycle watermark 회귀 시 차단). 품질저하방지 ③층 = **3층 완성**. 오탐 0(선언 축만 검사). hermetic 합성 fixture가 작동 증명 + close SKIP 사각 우회. 독립 리뷰가 footgun 1건 포착. `cycles/20260602-cross-cycle-ratchet/`
- [x] **#009** packaging install onboarding — `harness-export.py`(draft→top-level `./harness` self-contained 빌드, 컨셉문서 평탄화, 안전거부+마커 멱등) + marketplace.json `harness` peer 등록(source `./harness`, v0.2.0) + `harness:install` 스킬(대화→L1 user-rules) + `user-rules-init.py`(12-layering frontmatter, 멱등). **설치 경로 개통**. 게이트가 빌드 전 self-containment 블로커 포착. 독립 리뷰가 잠복 버그 2건 포착(rules-load 0룰 파싱 vacuous→파서 재작성, 빌더 export 혼입→제외). `cycles/20260602-packaging-install-onboarding/`
- [x] **#010** rule layering engine — `ruleslib.py`(L0 카탈로그+L1 per-rule 파서, 머지 순수함수)+`rules-merge.py`(CLI effective/conflicts/layers)가 L0+L1을 stage별 우선순위(L1>L0) 머지 + provenance + invariant 보호("(필수)" 섹션 마커) + 충돌 비해석(같은-layer 중복 exit2, AP-26). **install이 만든 L1이 실제 적용됨**(#009 F4 해소). MVE=L0+L1, 포맷 SSOT=L1/L2/L3 1개 통일·L0 카탈로그 유지(churn 0). 독립 리뷰가 stage 어휘 죽음(F1)·WIP 기만 no-op(F2) 포착→user-rules-init stage를 L0 어휘로 정렬+WIP additive화. **머지 실행이 "WIP=1이 06-rules.md에 룰로 없음"(F4) 노출**. self-test 9/9. `cycles/20260602-rule-layering-engine/`
- [x] **#011** entropy gc — `gc-scan.py`(결정론적 표면 스캐너: GP-1 relic-dir watch·GP-2 dead-link high·GP-3 dup-parser Rule-of-Three watch)+`GOLDEN-PRINCIPLES.md`(선언, 비해석)+hermetic self-test(3-sabotage 검증)+ratchet 축 2개(`harness-entropy-found`↑·`harness-entropy-remaining`↓). **원칙6를 우리 코드에 처음 적용**. 정리: dead link 4개(→`templates/retro.md` 생성)·hooks/README 역방향 stale 정정(5개 구현 반영). **핵심 발견(F1)**: 구조 휴리스틱이 signpost↔relic 못 가름(GP-1 0/2 정밀도)→watch 강등; "내용판단 필요=high-confidence 아님". 독립 리뷰가 self-test 비-vacuous 입증+low 2건 포착. fixpoint exit0. `cycles/20260602-entropy-gc/`
- [x] SSOT 정리 (#001 F6) — 플러그인이 canonical, draft scripts 삭제.
- [x] Böckeler "Harness Engineering" grounding (`00 §0.2b`) — CV-1 외부 검증.

---

## 💰 토큰 최적화 (= Now 키스톤 "토큰 경량화"의 상세 · **측정 완료 2026-06-03**)

> **실측 (export = 실제 설치 컨텍스트)**:
> - rule-inject SessionStart → **매 세션 L0 45룰 ≈ 766 토큰 (3065 chars)**, 빈 L1 신규유저도 동일. body(rules-merge) 2938 chars/734 tok + BOUNDARY.
> - 포맷: 룰당 3줄, `_layer:_` 줄은 ×45 거의 순수 오버헤드.
> - **draft↔export 발산**: draft엔 `plugin/harness/06-rules.md`가 없어 L0=0 → self-test의 "최소주입"(B2)이 *vacuous로 통과*(0<45 자명). export(=현실)에선 inj=catalog=45 → **B2 실제 실패**. test-rule-inject.sh가 populated L0를 한 번도 안 쳤다(테스트 사각).
> - 근본: L0는 *정적*(매 세션 불변). 정적 참조 통째 재주입 = 원칙1 위반. 동적·세션관련 = L1/L2/L3 + invariant + override분뿐.
>
> **제약(사용자 2026-06-03): 기능 저해 금지.** 압축이 아니라 *재주입 안 함*. 전량 카탈로그는 06-rules.md + `rules-merge effective --stage`로 *on-demand 조회 유지*. invariant는 항상 주입. 단계 진입 시 그 stage 룰 도달 보장.

**파일-분리 3파트 (병렬 진행 완료 2026-06-03):**

- [x] **P1 — 주입 토큰 경량화 (핵심 레버)** — **lossless 포맷 압축만: 766→620 토큰 (≈19%↓), 룰 누락 0**. 파일: `rules-merge.py`·`rule-inject.py`·`test-rule-inject.sh`(+`test-rules-merge.sh`·`test-harness-export.sh` 포맷 consumer 갱신)
  - [x] 포맷 1줄/룰: `## R-AI01 (L0!): title` (invariant=`!`, layer 인라인). `_layer:_` 줄+공백 제거 → 766→620, **전량 effective 그대로 주입(룰 안 뺌)**. `^## R-` grep 호환 유지.
  - [~] ~~슬라이싱(정적 L0 default 빼기)으로 365까지~~ → **독립 리뷰(2026-06-03)가 기능저해로 반려**. 뺀 25룰이 곧 *코딩 룰*(SOLID/KISS/YAGNI/DRY/SoC/tech-debt)이고, 작업 단계에서 자동 재주입하는 메커니즘이 없어("--stage 조회"는 자동 호출자 부재로 실효 없음) 코딩 세션에 코딩 룰이 사라짐. → **stage-injection 후속까지 보류**. `--dynamic` 플래그는 그 빌딩블록으로 남김(세션주입 미사용, help에 ⚠ 명시).
  - [x] **test-rule-inject.sh 비-vacuous 재작성** — export(populated L0 45룰)로 빌드해 검증: inj==full(룰 누락 0=기능보존), 포맷 인라인 layer 압축(verbose `_layer:` 부재), R-CD* 코딩 룰 잔존, 빈 L1도 전량 compact·L1 누출 0. 4 self-test PASS.
- [x] **P2 — 문서/SKILL 비대 (원칙1)** — **감사 결과: 문서는 이미 lean**. SKILL.md 2개는 거의 100% operative(frontmatter/Step/명령/표) → 안전 삭감분 ~13토큰뿐(13 §3 malformed 테이블 헤더 수정). 개념문서 00~13은 *정직한 detail 티어*(원칙1이 허용하는 "백과사전" 절반, 자동주입 아님·heading은 inter-doc 앵커) → 건드리면 기능저해. PROPOSE-ONLY 후보 ~400토큰 남김(11-anti-patterns 압축 등, 사람 판단). **결론: 토큰 표면은 문서가 아니라 주입(P1)이었다 — 가설 검증됨.**
- [x] **P3 — 토큰 계측 (순수 추가)** — `token-profile.py` 신설(stdlib, ruleslib 재사용, hermetic temp export). `--baseline`=주입 ~토큰(현재 620). 파일 분리.
  - [ ] **ratchet 축 `inject-tokens`↓ 등재** (잔여) — 현재값 **620** watermark로 lock → 회귀(누가 verbose 포맷 복귀) 차단. "측정 가능성=강제 가능성"(#004). *다음 close에서 bar-register 축으로 결박.* (주의: watermark는 실측 정수와 일치시킬 것 — 리뷰 [MED] 365≠366 교훈)
  - [ ] **profiler rule-count 라벨 수정** (리뷰 [LOW]) — 헤더가 주입 슬라이스 토큰에 전량(45) rule-count를 붙여 오해 소지. 주입된 룰 수로 정렬.
  - [ ] prompt 캐싱 정렬 실측(`13 §5`, 5분 TTL) — 정적(L0)/동적(L1) 경계 분리가 캐시 히트에 유리한지. (별도, 외부 측정)

### 🎯 stage-injection (= 슬라이싱의 *기능보존* 버전 · 더 큰 토큰 win, 별도 사이클)
- [ ] **stage-entry 자동 재주입** — 슬라이싱(정적 L0 default 빼기)이 기능저해인 *유일한* 이유는 "단계에서 다시 안 들어옴". stage 진입(예: code-writing 시작) 시 그 stage 룰을 자동 주입하는 hook/훅킹을 만들면, 세션주입을 invariant+L1로 줄여도 코딩 룰이 코딩 때 들어와 *기능보존*. 그때 620→~365 추가 win 회수. SessionStart는 stage 모름 → stage 신호원(skill 진입?) 설계 필요. 06-rules의 `**로딩 시점**`(stage 태그)이 이미 SSOT.

> ⚠ **자동주입 사이클(`cycles/20260602-rule-auto-injection`) 미종료** — 종료 전 **review-register(아래 독립 리뷰 결과) → close-cycle 게이트** 필요(원칙3). B2(최소주입) 바는 "lossless 포맷 압축"으로 재해석해 충족(슬라이싱은 후속). 독립 리뷰가 슬라이싱=기능저해를 포착해 **반려→lossless로 정정**(게이트 작동 실증).
> ⚠ **설계 판단**: 빈 L1 신규유저도 전량 L0(45) compact 주입(620tok) — 원래 동작의 lossless 압축판. 코딩 룰을 코딩 단계에만 주입하는 진짜 최소화는 stage-injection 후속.




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

 


