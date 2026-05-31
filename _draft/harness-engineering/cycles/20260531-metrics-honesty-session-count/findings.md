# Dogfood Findings — metrics honesty session count

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | 개발 | `cycle-init.py`가 #004를 *구 스키마*(time_spent_hours/budget_spent_pct)로 스캐폴드 → 자신을 수동 마이그레이션해야 했음 | low | ✅ 해결 — cycle-init 신스키마로 갱신, #004 metrics 수동 마이그레이션. 향후 신규 사이클은 자동 신스키마 |
| F2 | 설계 | `budget$`는 하네스가 *돈 신호를 관측 못 함* → kill 지표로 두면 항상-0(거짓 OK) Sensor. 측정 불가 지표를 강제선에서 제거 | medium(긍정) | ✅ 드롭 — "측정 가능한 것만 강제한다" 원칙 확립. `13 §3` Computational/Inferential 경계의 실증 |
| F3 | 설계 | `reentry_count`는 여전히 *Inferential* — 단계 재진입을 게이트/사람이 기록해야 함. session_count만 Computational화됨 | medium | 백로그 — 자동화엔 게이트 계측 필요(별도 사이클). 지금은 정직하게 "수동"으로 둠 |
| F4 | 개발 | SessionStart hook 2개(verify + counter)가 같은 active symlink·metrics를 각각 읽음 — 약간 중복 | low | 단일 책임 위해 분리 유지: verify=읽기전용 Sensor, counter=writer. 섞으면 책임 흐려짐 |

## 살아있는 로그
- **개발/테스트 완료.** session-counter.py(SessionStart) + kill-check.py 재작성 + cycle-init 스키마 갱신 → self-test 8/8.
- **H1 지지**: (a) startup→+1, (b) resume/compact/clear→미증가, (c) kill-check soft(>appetite)/hard(>2×)/reentry(≥3) 정확 발동. scratch로 검증, 실제 #004 무손상.
- **큐 2번(deploy kill-check Sensor) 선행조건 해소**: metrics가 정직해졌으니 #005에서 kill-check를 deploy hook으로 wiring 가능.
