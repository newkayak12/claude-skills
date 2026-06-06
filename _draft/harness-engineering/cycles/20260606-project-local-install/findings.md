# Dogfood Findings — project-local-install

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | validation | delivery vendoring 이 per-project+ambient 를 동시에 연다(hook 상대 fallback이 이미 받쳐줘 재배선만). B1~B4 pass | — (입증) | — |
| F2 | validation | **close-cycle `--force` 가 blackbox 에 기록 안 함** — ratchet override 가 사이클 감사 흔적에 안 남음(phase-advance --force 는 남기는데). ADR 존재 검사도 없음 | **high** | 후속: close --force → blackbox append + `--adr` 결박 |
| F3 | validation | ratchetlib lower_better 에 "accept-new-baseline" 부재 — force 수용해도 floor=best 유지 → 은퇴 전까지 --force 상시화 | medium | 후속: force 시 floor 수용값 갱신 옵션 |
| F4 | implementation | installer(project-install.py·test-) 를 페이로드에 두면 harness-export 끊긴 참조(#009 동형) | — (결정) | EXCLUDE 추가 — *단 F5로 역효과* |
| F5 | post-close | **게이트가 broken 산출물을 pass — doer·리뷰어 둘 다 dogfood 컨텍스트에서만 테스트.** project-install이 harness-export(_draft 전용) subprocess 의존 + 그 둘이 글로벌 플러그인에서 제외돼 **프로덕션 install Step A가 file-not-found로 실패.** dogfood(plugin/harness/scripts/)에선 harness-export가 있어 통과 → #007/#009 "cwd가 설치맥락 가림" 사각의 실제 발현(CV-1) | **high** | #014b: project-install 직접복사로 재작성 + 프로덕션 경로(빌드된 harness/) 테스트로 사각 폐쇄 |

## 살아있는 로그

### F2 상세 — close `--force` 의 blackbox 미기록 (high)
`close-cycle.py:77-78` 은 `--force` 시 stderr WARN 만 출력하고 `blackbox.jsonl` 에 append 하지 않는다.
이후 "black box 대면"(L134~143)이 blackbox 를 읽어 "비어 있음 — override 0건" 을 표시 — *방금 ratchet 을
강제 우회했는데도*. 게이트 우회 중 가장 센 ratchet override 가 *불가시*. ADR 강제도 없음(수동 신뢰).
수정: close `--force` → `{kind:"force-close", regressions:[...], ts}` blackbox append + `--adr <path>` 결박.
이 사이클은 이미 force-close 됨 → 고치지 않고 인계(닫힌 사이클 수정 금지).

### F3 상세 — ratchet accept-new-baseline 부재 (medium)
force-close 로 28 수용해도 `compute_floor` 는 best=27 유지(강제 회귀는 floor 못 올림). deploy-kill-check
은퇴(27 복원) 전까지 이 축에서 후속 --force 상시화 → ratchet 무력. ADR-0001 trade-off 명시.
