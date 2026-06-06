# Retrospective — ratchet-axis-lock

> 사이클 *종료 시* 작성. (roadmap rank0→rank1 적용 사이클)
> 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로), [`think:retrospective`]

## 무엇을 배웠나

- **차별화 자산이 사실상 비활성이었다.** ratchet(#008)이 cross-cycle 품질을 지키는 유일 자산인데,
  floor에 잡히던 stable 축은 entropy-gc 부산물 2개뿐 — 의미있는 축 0개. "측정해놓고 안 잠근" 부채를
  코드 실측이 드러냈다(로드맵 핵심 value-add). 이번에 mechanism-count(27)·inject-tokens(385) 등재로
  floor 의미있는 축 0→2.
- **로드맵을 그대로 따르지 않은 게 옳았다.** rank0(a)는 "bytes/4를 실토크나이저로 교정"을 권했지만,
  코드를 보니 ratchet은 *절대 정확도가 아니라 같은-방법 cross-cycle 일관성·단조성*만 필요 → 실토크나이저는
  새 의존성 + 여전히 근사 + 무의존성 설계 파괴로 이득 0. 사용자 판단 후 bytes/4 유지 + docstring 명시로 전환.
- **roadmap rank7(GP-5 "23→27" 정정)의 전제도 틀렸다.** "23" 리터럴은 코드/문서 어디에도 없음 —
  mechanism-count는 스캐너가 동적 출력. 또 한 번 코드 검증이 워크플로우 산출 주장을 걸렀다.

## 놀란 것 (예측 vs 실제)

- inject-tokens가 로드맵/#012 기록값 620이 아니라 **385**. 그 사이 룰이 줄어든 것 — 더 낮은 현재값에
  잠가 그 이득까지 포착(watermark는 best=lowest).
- count_complexity가 이미 코드 직접 산출(rank0(b)는 사실상 충족) — 남은 건 *문서가 그걸 신뢰하게* 만드는 것뿐.

## 다음에 바꿀 것

- **rank2(bar-register `--axis` 강제화)** 가 다음 사이클. 지금은 축 메타가 선택적이라 수치 measure가
  free-text로 새는 root cause가 남아있음. 단 하위호환(축 없는 boolean 바)을 깨므로 분리 진행.
- ratchet floor에 의미있는 축이 생겼으니, 이제 "빼기" 사이클(active-cycle-verify/deploy-kill-check 은퇴)이
  mechanism-count를 *내리는* 방향으로 가능 — 첫 lock값 27을 다음 은퇴와 짝지어 26 이하로.

## 인계 (살림 / 의심 / 버림)

- 살림: floor 2 의미있는 축(mechanism-count 27·inject-tokens 385) + token-profile docstring의 "왜 실토크나이저
  안 쓰나" 근거(다음 사이클이 같은 권고 재제기하지 않도록 박제). test-ratchet-check lower_better teeth 케이스.
- 의심: 27 lock이 *증식 억제*엔 맞지만, 새 메커니즘이 정당하게 필요한 사이클은 close가 막는다 →
  은퇴 후보 지명을 강제하는 게 의도지만, 막다른 길이면 `close --force`+ADR 탈출구에 의존(self-stamp 통로).
- 버림: roadmap rank7(23→27 문서정정) — 정정할 리터럴이 없어 무효 처리.

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- 없음(게이트 전 구간 준수: pre-registration → phase 전진 → 독립 리뷰(doer≠reviewer, subagent) → close).
  blackbox 0건(override/force 미사용).
