# Dogfood Findings — deploy-kill-check-retire (#015)

> roadmap rank6 + ADR-0001 인계. "빼기" 사이클 — mechanism-count 28→26.

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| K1 | implementation | **session_count orphan** — kill-check 은퇴로 `metrics.json:session_count`(session-counter가 매 세션 +1)의 *자동 소비자*가 사라짐. 이제 retro·진단용 계측치로만 남음. session-counter 자체 은퇴는 metrics 갱신자라 rank4(metrics SPOF 가변/불변 분리)와 교차 → 단독 제거 위험. | low | 후속: session-counter 은퇴 여부를 rank4와 묶어 검토. 이번엔 정직 표기(주석)만. |
| K2 | implementation | `kill_check` 필드(METRICS_SKELETON)는 읽는 코드 0 → vestigial. 제거함(빼기 일관). `appetite_sessions`는 session-counter:76이 여전히 읽어 orphan 아님 → 보존. | (수정) | 제거 완료 |
| K3 | validation | ratchet floor가 force-close된 28이 아니라 *선언 best* 27이었기에(#014 F3 standing 부채), 26 선언이 27 floor 대비 단조 개선으로 **--force 없이** 통과 — ADR-0001 standing 부채 해소. F3(accept-new-baseline 부재)는 "빼기"로 우회됐을 뿐 ratchetlib 갭 자체는 잔존. | (입증) | F3은 ⓕ 후속 유지(빼기가 매번 가능한 건 아님) |
| K4 | validation | 히스토리 위조 회피 확인 — devils-advocate.md(#011 changelog)·GOLDEN-PRINCIPLES.md(#011 F2 재검토 실증)·13 §4 blackbox 예시 로그는 *날짜박힌 사실*이라 미변경. 라이브 동작 문서(README hook 목록, 13 §3 코드강제 표/트리거 표)만 갱신. | (입증) | — |

## 살아있는 로그

### K3 상세 — "빼기"가 F3을 우회하지만 해결하진 않는다
#014 F3: lower_better 에서 force-close 가 floor 를 올리지(낮추지) 못해 standing 부채. 이번엔 *실제로 메커니즘을
2개 빼서* count 26 을 정직 달성 → 27 floor 대비 단조 개선이라 ratchet 이 정상 통과(force 불요). 즉 **"은퇴로
빼기"가 가능한 사이클에선 F3 이 안 보인다.** 그러나 빼기가 불가능한데 정당하게 +1 해야 하는 미래 사이클에선
F3(accept-new-baseline)이 다시 문제 → ⓕ 후속 유지. ADR-0001 의 "은퇴로 27 복원" trade-off 를 27보다 더
내린 26 으로 초과 달성.
