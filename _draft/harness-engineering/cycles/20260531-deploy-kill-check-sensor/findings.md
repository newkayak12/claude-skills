# Dogfood Findings — deploy kill-check sensor

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | 설계 | exit 코드 매핑이 *세 갈래*(차단/경고/통과)로 갈림 — kill-check의 0/1/2/3을 hook의 행동(exit 0 vs 2)으로 번역해야. Soft를 *차단 아님*으로 둔 게 핵심: 재평가는 사람 결정(07 §7.5) | low | ✅ 매핑 명시: hard→exit2 차단, soft→exit0+경고, ok/err→exit0 |
| F2 | 테스트 | deploy 키워드 *오탐* 가능 — "배포 얘기"만 해도 발동. 단 Hard 차단은 *active 사이클이 hard-kill 상태일 때만* 추가 발동이라 실해 적음. 게다가 fail-open | low | 수용 — 키워드 오탐의 비용 < 배포 강행의 비용. 정밀 의도판정은 Inferential(과함) |
| F3 | 개발 | hook이 kill-check를 *subprocess*로 부름(#003 verify 패턴 재사용). 코드 중복 없이 단일 kill-check 로직 재사용 — SSOT 유지 | low(긍정) | 패턴 확립 — Sensor가 script를 부르는 골격 |

## 살아있는 로그
- **개발/테스트 완료.** deploy-kill-check.py(UserPromptSubmit) + hooks.json wiring → self-test 7/7.
- **H1 지지**: (a)non-deploy→통과, (b)ok→통과, (c)soft→경고, (d)hard→차단(exit2), (e)no-active→fail-open, (f)영문키워드→차단, (g)JSON실패→fail-open.
- **#004 선행 효과 실증**: metrics가 정직(session_count 자동)해졌기에 이 Sensor가 *실데이터*로 판정. #004 없이 wiring했으면 항상-ok 거짓 통과였을 것.
- **3 이벤트 Sensor 완성**: PreToolUse(차단) + SessionStart(탐지·측정) + UserPromptSubmit(배포 차단). Böckeler Sensor가 이벤트 성격별로 자리잡음.
