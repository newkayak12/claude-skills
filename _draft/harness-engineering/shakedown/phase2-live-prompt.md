# Phase 2 — 라이브 micro-cycle 프롬프트 (시운전 본체)

> **사용법**: harness 플러그인이 설치된 상태에서, **빈 디렉터리**를 만들어 거기서 claude를
> 새로 띄운다. 아래 `===` 블록을 *그대로* 첫 메시지로 붙여넣는다. claude 런타임이 실제로
> hook을 발화시키는 유일한 경로 — 이게 H1·#005의 첫 실측이다.
>
> 준비:
> ```bash
> mkdir -p /tmp/harness-shakedown && cd /tmp/harness-shakedown && claude
> ```

---

```
너는 지금 harness 플러그인의 첫 시운전(shakedown) 대상이다. 목표는 "좋은 코드"가 아니라
"하네스 기계장치가 실제로 발화하는지"를 정직히 관측하는 것이다. 아래를 순서대로 하되,
각 단계 뒤에 [BLACKBOX] 표의 해당 행을 즉시 채워라 — 추측 말고 실제로 본 것만.

규칙:
- 발화한 것만 FIRED로 적는다. 출력/차단을 직접 못 봤으면 SILENT다. "잘 됐을 것"은 금지.
- 게이트가 막아야 할 때(변조·무리뷰·회귀) 실제로 막았는지가 핵심이다.
- doer≠reviewer: 구현과 리뷰를 같은 흐름에서 자찬하지 말고, close 전 독립 리뷰를 분리해라.

단계:
1. [세션 시작] 이 세션 시작 시 harness rule-inject가 컨텍스트에 룰을 주입했나? 보였으면 그 첫 줄을 인용.
2. harness:install 을 실행. 대화로 user-rules를 설정(언어 Python/FastAPI, WIP 1). 수동 파일작성이
   아니라 대화→스크립트 흐름이었는지 확인.
3. harness:cycle 로 새 사이클 진입. pre-cycle 게이트를 통과하고 cycle-init이 cycles/<id>/ 를
   scaffold 했는지 확인(ls로).
4. 토이 과제 구현: FastAPI 앱에 GET /health → {"status":"ok"} 엔드포인트 1개 + pytest 테스트 1개.
   첫 파일 Edit/Write 시점에 stage-inject가 R-CD 코딩룰을 주입했나? 보였으면 인용.
5. [의도적 변조] 등록된 가설/바 파일(hypotheses.jsonl 또는 bar.jsonl)을 손으로 한 글자 고쳐
   저장 시도. hypothesis-immutability hook이 막았나? (막아야 정상)
6. 테스트 실행해 실제로 통과시킨 뒤(증거=실행 로그), close-cycle 시도.
   먼저 독립 리뷰 없이 닫기를 시도 → 차단되나? 그다음 회귀하는 ratchet 축을 선언 → 차단되나?
7. 독립 리뷰(이 PR의 문제점만 찾는 회의적 관점)를 거쳐 통과시킨 뒤 정상 close → retro 한 줄.

마지막에 아래 표를 완성해서 출력하고, 이 디렉터리에 shakedown-result.md로 저장해라:

[BLACKBOX]
| 기계장치 | 기대 | 관측(FIRED/SILENT/BLOCKED-OK/FAILED) | 근거(인용/로그) |
|---|---|---|---|
| rule-inject (SessionStart) | invariant+L1 주입 | | |
| stage-inject (첫 Edit) | R-CD 도착 | | |
| cycle-init | scaffold 생성 | | |
| hypothesis-immutability | 변조 차단 | | |
| close-cycle 리뷰 게이트 | 무리뷰 차단 | | |
| ratchet | 회귀 축 차단 | | |

그리고 정직 평가 한 줄: "1 사이클 끝낸 사용자로서 이 하네스가 도움이 됐나?" — yes면 근거,
no면 어느 단계가 마찰이었는지. (PF-8 교훈: null/약한 결과도 그대로 적어라.)
```

---

## 끝나면 (Phase 3)

`shakedown-result.md`의 [BLACKBOX] 표를 이 repo로 가져와서:
- SILENT/FAILED 각 행 → `TODO.md`(🔬 측정 대기 / 🩹 Watch) 또는 `devils-advocate.md`(CA/PF) 1줄 적재
- 이 프롬프트/metascript 갱신(시운전도 사이클 — retro가 다음 시운전을 싸게 만든다)
