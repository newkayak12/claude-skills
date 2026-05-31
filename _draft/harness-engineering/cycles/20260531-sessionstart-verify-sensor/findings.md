# Dogfood Findings — sessionstart-verify-sensor

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | 개발 | `os.readlink(active)`가 상대 타깃 반환 — `Path(...).name`으로 정규화 필요 (절대/상대/중첩 대비) | low | ✅ 해결 — `Path(cycle_id).name` 적용 |
| F2 | 테스트 | 변조 *탐지*는 하나 *복구*는 수동. tampered 경고를 사용자가 무시하면 강제력 없음 | medium | 백로그 — 자동 롤백은 과함. black box 대면 + 경고 반복으로 충분 판단 |
| F3 | 개발 | #002 hook 패턴(stdin/exit/fail-open) 재사용 → 빌드 빠름. *도구가 도구를 짓는* Steering Loop 실증 | low(긍정) | 패턴 확립 — 다음 hook도 이 골격 |

## 살아있는 로그
- **개발/테스트 완료.** SessionStart hook 빌드 → self-test 3/3 → hooks.json wiring.
- **H1 지지**: intact→확인, no-active→silent, tampered→경고(hash mismatch 상세). active 사이클 손상 없이 scratch로 검증·복원.
- **#002 F2 해소**: PreToolUse 사각(세션 밖 편집)을 SessionStart 탐지로 보강. 두 Sensor가 짝(차단+탐지).
