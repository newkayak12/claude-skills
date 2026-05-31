# Harness Engineering — TODO

> 사이클 retro 큐 + devils-advocate 잔여 + dogfood findings 백로그를 한 곳에 모음.
> 우선순위 정렬. 사이클 종료 시 여기 갱신. SSOT는 각 `cycles/<id>/retro.md`이고, 이 파일은 *집계 뷰*.
> 관련: [GOAL.md](./GOAL.md) · [devils-advocate.md](./devils-advocate.md) (취약점 누적 로그)

마지막 갱신: 2026-05-31 (사이클 #004 종료 직후)

---

## 🔜 Now — 다음 사이클 후보 (선행조건 해소됨)

- [ ] **#005 deploy kill-check Sensor wiring** — `UserPromptSubmit`('배포/deploy' 키워드) → `kill-check.py` exit 2면 차단. *#004로 metrics 정직화돼 선행조건 해소(unblocked)*. → `13 §3`, devils CA-1 계열.
- [ ] **GOAL 앞단 — 설치/온보딩 경로** (GOAL.md §2 1~4단계, *아직 미착수*)
  - [ ] marketplace.json에 `harness` 플러그인 등록 + `<plugin>/README.md`
  - [ ] `harness:install` 온보딩 skill — interactive
  - [ ] interactive **L1 user-rule** 설정 (`~/.harness/user-rules.md`) → `12-rule-layering.md`

## 🧱 Backlog — 구조/계측 (별도 사이클 필요)

- [ ] **reentry 자동화** (#004 F3) — `reentry_count`는 아직 Inferential·수동. 게이트 단계 재진입을 *계측*해야 자동화 (SessionStart로는 못 잡음).
- [ ] **08-pass-criteria 타입별 Gate 변형** (#001 F9) — Product/Dev-tool/Exploration 별 Gate 기준. `09 §9.1b`는 했고 `08`은 미반영.
- [ ] **pivot-triggers 위치 결정** (#001 F8) — cycle-card 인라인 vs 별도 파일.
- [ ] **tampered 후 자동 복구/롤백** (#003 의심) — 현재 *탐지*만, 복구 수동. black box 대면에 의존. (자동 롤백은 과할 수 있음 — 판단 필요)
- [ ] **13 §7 나머지 최적화** — tier-A 압축, prompt 캐싱 정렬 실측, 미구현 hook들 (16개 spec 중 일부).

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
- [x] SSOT 정리 (#001 F6) — 플러그인이 canonical, draft scripts 삭제.
- [x] Böckeler "Harness Engineering" grounding (`00 §0.2b`) — CV-1 외부 검증.
