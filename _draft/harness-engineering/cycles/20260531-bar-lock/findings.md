# Dogfood Findings — bar lock

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | build (Chunk 2) | **plan 자체의 버그** — `test-bar-register.sh`의 `cd .../../..` 깊이가 틀림(`/../..`→`plugin/`, 실제 필요 `/../../..`→루트). fresh implementer subagent가 잡아 수정 | low | 수정됨. *독립 실행자가 계획자(나)의 실수를 잡음 — #007 가치의 사전 입증* |
| F2 | review (Chunk 1) | `chainlog.last_hash`가 `hash` 없는 마지막 줄에 KeyError(원본 hypothesis-register에서 상속). 보안 임계 코드에서 손상이 조용히 GENESIS로 치환될 위험 | medium | `ValueError`(손상 가시화)로 수정. quality 리뷰어가 잡음 |
| F3 | build (Chunk 3) | hook 파일명 `hypothesis-immutability.py`가 이제 `bar.jsonl`도 보호 → 이름이 좁음. hooks.json에 wired라 rename 보류 | low | docstring 일반화. rename 후보로 기록 |
| F4 | design | `bar.jsonl`의 `measure` 필드는 **현재 소비자 없음**. 바를 *잠그는 것*과 *충족을 강제하는 것*은 별개 — #007(독립 리뷰 close 게이트)·#008(ratchet)이 읽어야 강제됨 | (설계) | #007/#008로 추적. #006 단독은 절반값 |
| F5 | final review | **`active-cycle-verify.py`(SessionStart)가 `bar.jsonl`은 verify 안 함** — `hypotheses.jsonl`만 검증. #002 F2(세션 밖 변조 탐지)의 *대칭 갭*이 바에 그대로 존재. final 리뷰어가 잡음(이번에도 구조가 누락을 발견) | medium | backlog로 — #007에서 함께 처리(close 게이트가 bar verify 포함) |

## 살아있는 로그

- 구조적 관측(F1): subagent 분산 실행에서 **독립 implementer가 orchestrator의 plan 버그를 즉시 발견**. "doer가 못 보는 걸 fresh 컨텍스트가 본다"가 narrative가 아니라 이 사이클에서 *실측*됨 — #007 독립 리뷰 게이트가 노리는 바로 그 효과.
- 보안 관측(F2): chainlog **추출(DRY)** 덕에 리뷰어가 *한 구현*을 집중 검증 → latent KeyError 발견. 중복 상태였다면 한쪽만 고쳐졌을 것. DRY가 리뷰 표면을 줄여 결함 발견율을 높임.
- 속도 관측: appetite 2세션 예상이었으나 subagent 병렬(implement + spec/quality 동시 리뷰)로 **1세션 실측**. kill-check 여유.
