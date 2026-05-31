# Retrospective — bar lock (#006)

> dev-tool / self-user. 품질 저하 방지 3층(①바-잠금 ②독립리뷰 ③ratchet) 중 **①**. GOAL: Claude 품질의 사이클별 저하를 *구조적으로* 막기.

## 가설 결과

| 가설 | 결과 | 근거 |
|---|---|---|
| **H1** — bar-register.py가 품질 바를 hash chain으로 등록, immutability hook이 bar.jsonl 직접 편집 차단(exit2), 정당 append는 통과, verify가 변조 탐지. chainlog 추출 후 기존 hypotheses 체인 회귀 없음 | **지지** | self-test: chainlog PASS(양 분기—TAMPERED/chain-broken), bar-register PASS, hook(hyp=2/bar=2/ok=0/failopen=0), 기존 가설 verify OK×2. kill-line 미발동 |

## 무엇을 배웠나

- **독립 리뷰가 *실제로* 계획자의 실수를 잡았다.** fresh implementer subagent가 내 plan의 `cd` 깊이 버그(F1)를, quality 리뷰어가 latent KeyError(F2)를 발견. "doer/계획자가 못 보는 걸 fresh 컨텍스트가 본다"가 narrative가 아니라 이 사이클에서 *관측*됨 — 다음 사이클 **#007(독립 리뷰 게이트)의 가치를 dogfood가 미리 입증**. 계획자도 틀린다는 직접 증거.
- **바를 *잠그는 것* ≠ 충족을 *강제하는 것*.** #006은 바를 immutable하게 만들 뿐. `measure` 필드는 #007(close 게이트)·#008(ratchet)이 읽어야 비로소 "충족 안 하면 close 차단"이 됨. 정직하게: **#006 단독으로는 품질 저하가 안 막힌다 — 셋이 합쳐야 함.**
- **DRY(chainlog 추출)가 보안에 기여.** 체인 로직을 한 구현으로 모으니 리뷰어가 그 한 곳을 집중 검증 → 결함 발견. 중복이었으면 한쪽만 고쳐졌을 것. "측정 가능성=강제 가능성"(#004)이 bar의 measure 필드로 연결됨.

## 놀란 것 (예측 vs 실제)

- appetite 2세션 예상 → **1세션 실측**. subagent 병렬(구현 + spec/quality 동시 리뷰)이 빠름.
- **놀란 핵심**: 내 *plan 자체에 버그*가 있었고(테스트 cd 깊이), 그걸 *구조(독립 implementer)*가 잡았다. 사람이 아니라 구조가 품질을 지킨 첫 관측 사례.

## 다음에 바꿀 것

- **#007 즉시 진행** — measure 필드 소비자(독립 리뷰 close 게이트)가 없으면 #006은 절반값. 이번 dogfood가 독립 리뷰 효과를 입증했으니 자연스러운 다음 수.
- hook 파일명 `hypothesis-immutability.py` rename 검토(이제 bar.jsonl도 보호 — 이름이 좁음, F3).

## 인계 (살림 / 의심 / 버림)

- **살림**: `chainlog.py`(공유 체인 SSOT), `bar-register.py`, bar.jsonl 보호 hook 확장, **"독립 fresh-context가 계획자/실행자의 실수를 잡는다" 패턴**(→ #007의 핵심 근거), 손상-가시화 last_hash(ValueError)
- **의심**: `measure` 소비자 없는 채 두면 죽은 필드(#007 안 하면 #006 절반값). hook은 여전히 스키마 self-test만 — 실제 `claude` 설치 환경 통합 테스트 미수행(#005 인계 유지). appetite를 사람이 틀리게 잡으면 kill 오발동(#004 인계 유지)
- **버림**: 없음

## 어긴 룰 / Anti-pattern (black box 대면)

`blackbox.jsonl` 비어 있음(0바이트) — override/skip/강행 0건(**B3 충족**). 가설·바 chain 둘 다 intact. WIP=1 준수(시작 시 --check-wip 확인). 스코프 준수(plan 4 chunk + ceremony). invariant 위반 0건.

## 다음 사이클 큐

1. **#007 독립 리뷰 게이트** — fresh subagent가 잠긴 바(measure)에 대고 채점, verdict=pass + bar-hash 참조 없으면 close 차단. 이번 dogfood가 효과 입증.
2. **#008 ratchet** — 품질 지표 사이클 간 단조증가, 회귀 차단.
3. (#009+) GOAL 앞단 install/룰엔진 — packaging.
4. (잔여) hook 통합 테스트(#005), hook 파일명 rename(F3).
