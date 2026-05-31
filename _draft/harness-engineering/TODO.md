# Harness Engineering — TODO

> 사이클 retro 큐 + devils-advocate 잔여 + dogfood findings 백로그를 한 곳에 모음.
> 우선순위 정렬. 사이클 종료 시 여기 갱신. SSOT는 각 `cycles/<id>/retro.md`이고, 이 파일은 *집계 뷰*.
> 관련: [GOAL.md](./GOAL.md) · [devils-advocate.md](./devils-advocate.md) (취약점 누적 로그)

마지막 갱신: 2026-05-31 (사이클 #006 종료 직후)

> **북극성 재정의**: Claude 품질의 *사이클별 저하*를 **구조적으로** 막는다. 3층 = ①바-잠금(#006 ✅) ②독립 리뷰 게이트(#007) ③ratchet(#008). 그 다음에 ④install/룰엔진(packaging).

---

## 🔜 Now — 다음 사이클 후보 (품질저하방지 우선)

- [ ] **#007 독립 리뷰 게이트** (품질저하방지 ②층 — 키스톤) — "done/close" 전 *fresh subagent*가 잠긴 바(`bar.jsonl`의 `measure`)에 대고 채점, `review.jsonl`에 기록. close-cycle 게이트가 **bar-hash 참조 + verdict=pass 없으면 close 차단**. doer≠reviewer로 자기 관대 채점을 구조적으로 깸. *#006 dogfood가 이 효과를 이미 입증*(독립 implementer가 plan 버그 잡음).
- [ ] **#008 ratchet** (품질저하방지 ③층) — 품질 지표 사이클 간 단조증가, 공통 축 회귀 시 차단.

## 🧱 Backlog — 구조/계측 (별도 사이클 필요)

- [ ] **GOAL 앞단 — 설치/온보딩 경로** (GOAL.md §2 1~4단계) — packaging. 품질저하방지 3층 후로 이연.
  - [ ] marketplace.json에 `harness` 플러그인 등록 + `<plugin>/README.md`
  - [ ] `harness:install` 온보딩 skill — interactive
  - [ ] interactive **L1 user-rule** 설정 (`~/.harness/user-rules.md`) → `12-rule-layering.md`
- [ ] **hook 파일명 rename** (#006 F3) — `hypothesis-immutability.py`가 이제 `bar.jsonl`도 보호 → 이름 좁음. hooks.json wired라 신중히.
- [ ] **`active-cycle-verify`에 bar.jsonl verify 추가** (#006 F5) — SessionStart 탐지가 가설만 보고 바는 안 봄(세션 밖 변조 대칭 갭). #007 close 게이트에서 함께 처리.

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

---

## ✅ Done — 완료 사이클 (집계)

- [x] **#001** harness-plugin-MVE — 설치 가능 상태까지. 게이트 자기적용 실증. `cycles/001-harness-plugin-mve/`
- [x] **#002** hypothesis-immutability Sensor — PreToolUse 차단(세션 내). `cycles/20260531-hypothesis-immutability-sensor/`
- [x] **#003** active-cycle-verify Sensor — SessionStart 탐지(세션 밖). #002 F2 해소. `cycles/20260531-sessionstart-verify-sensor/`
- [x] **#004** metrics 정직화 — session-count kill-check + session-counter hook. budget$ 드롭. "측정 가능성=강제 가능성". `cycles/20260531-metrics-honesty-session-count/`
- [x] **#005** deploy kill-check Sensor — UserPromptSubmit hook, Hard kill이면 배포 차단(exit2). 3 이벤트 Sensor 완성. `cycles/20260531-deploy-kill-check-sensor/`
- [x] **#006** 바-잠금 — `chainlog.py` 추출 + `bar-register.py`(품질 바 hash chain) + hook이 `bar.jsonl` 보호. 품질저하방지 ①층. dogfood가 독립 리뷰 효과 입증(plan 버그·latent KeyError 잡힘). `cycles/20260531-bar-lock/`
- [x] SSOT 정리 (#001 F6) — 플러그인이 canonical, draft scripts 삭제.
- [x] Böckeler "Harness Engineering" grounding (`00 §0.2b`) — CV-1 외부 검증.

---

## 💰 토큰 최적화 (맨 마지막 — 구조 안정화 후)

- [ ] **토큰 최적화 패스** — 품질저하방지 3층(#006~#008) 완성 후 착수. *구조가 굳기 전에 최적화하면 잘못된 타깃을 깎는다* (CA-3: "압축이 아니라 *모양* 자체가 무거움").
  - [ ] **tier-A 룰 압축** — SessionStart 주입분(effective rules) 최소화. `13 §7-1`.
  - [ ] **prompt 캐싱 정렬 실측** — 정적/동적 경계로 캐시 히트율 측정 (`13 §5`). 5분 TTL 고려.
  - [ ] **컨텍스트 윈도 예산** — 사이클당 주입되는 문서/메트릭/룰의 토큰 측정 → 임계 초과 시 경고 Sensor 검토.
  - [ ] **측정 먼저, 압축 나중** — 추측 압축 금지. 실측 토큰 프로파일 없이는 손대지 않는다 ("측정 가능성=강제 가능성" #004의 연장).
