# teams — 서버가 루프를 소유한다 (검토용 초안)

> 상태: **검토용**. 코드 변경 없음. 2026-09-21.
> 대상: `teams` 0.12.3 위에 얹는 다음 라운드. 0.13 계획(`2026-09-17-teams-team-v0.13.0.md`)은 이 문서가 결정된 뒤 다시 본다.
> 전제: 2026-09-17~21 벤치 5판(`/tmp/graph-bench/`)의 실측. 숫자는 전부 스트림/디스크에서 읽은 값.

## 0. 왜 다시 쓰나 — 지난 결론이 무효다

| 보고했던 것 | 실제 | 원인 |
|---|---|---|
| teams $4.53, plain $12.97 (2.9배 쌈) | teams **$45.92** (3.5배 비쌈) | `score.mjs`가 `$ws.stream*.jsonl`만 합산. 드라이버 7세션(`.harness-tasks/*/drivers/*.stream.jsonl`) $41.39 누락 |
| 6/6 vs 6/6 | 다른 6개 | teams는 `goal_met`(judge-failed) 대신 `decomposition`으로 6점째. 그 쪼개기는 `size_source: pinned` — 벤치 프롬프트 강제 |
| 채점 5기준 | 변별력 0 | npm_test / no_deps / readme / cli / tests_grown — 전부 "만들었냐". 세션 하나도 다 통과 |
| `max_parallel_teams: 2`, `size: pinned` | 사용자 제약 아님 | `teamconfig.mjs` 기본값과 벤치 프롬프트. 결과를 조건에 귀속시켰어야 함 |
| 과제 크기 | plain 최대 컨텍스트 **229,868** | 한 세션에 *간신히* 들어가는 크기. 쪼개기가 값을 하는 교차점 **아래**에서 잼 |
| seam 판 12/12 | 대조군 없음 | teams가 이길 만한 유일한 지점(`seam_detected=true, gate_rejections=6`)인데 plain 대조 미실행 |

**결론: 품질은 한 번도 못 쟀고, 비용은 10배 틀렸고, 조건은 teams가 이길 이유가 없는 곳이었다.**
"졌다"는 판단은 측정 오류 위에 있었다. 단, 아래 §1의 두 문제는 측정 오류와 무관하게 실재한다.

## 1. 진단 — 실재하는 문제 둘

### 1a. 루프를 모델이 돈다

```
매니저 세션   144턴 중 125턴이 순수 tm_next 폴링    $ 4.53   파일 0   (6.9M 토큰이 "끝났어?")
leader 세션    91턴 중  23턴 순수 폴링, 13 submit   $ 9.66   파일 0
driver ×6     team_next→Agent→team_submit = 1:1:1    $31.71   파일 0   (일은 서브에이전트가)
서브에이전트  56개                                    —        실제 산출
```

모델이 앉은 자리가 4층, 일하는 건 1층. 위 3층은 "다음 뭐야?"를 묻고 넘기는 릴레이다.
컨텍스트 분할 자체는 **의도대로 작동했다**(워커당 62~146k). 배수는 공용분이 아니라 **턴 수**(305 vs 115)다 —
드라이버 첫 턴 컨텍스트는 18~20k로 무시할 크기. "공용분 N번 지불" 가설은 데이터가 기각한다.

**왜 이렇게 됐나.** `cf8842d`: *"the design assumed someone is watching."* 사용자가 세션에 앉아 보는 대화형을
전제로 매니저 세션이 그래프를 봐주는 형태로 시작 → 매니저가 나가도 돌아야 해서 leader 프로세스 추가
(09-17 문서 §6) → 패키지가 커서 driver 추가. 패치 위에 패치. 헤드리스로 돌리자 전제가 전부 비용이 됐다.

**그래프를 아는 것도, 드라이버를 띄우는 것도 이미 MCP 서버다**(`spawnChildDriver`, `task.s_run`, `child_run_id`).
엔진을 만들고 그 위에 엔진이 아는 걸 되묻는 모델 세션을 세 층 얹은 것이다.

### 1b. 카드 밖을 아무도 안 본다

| | plain | teams (integration 워크트리) |
|---|---|---|
| src | 26파일 / 2,893 LOC | 5파일 / 655 LOC |
| test | 1,207 LOC | 826 LOC |
| packages | cli **core** csv report rules | cli csv report rules |
| rules 패키지 | 525 LOC (config 232 + matcher 218 + index 75) | **113 LOC** |

STORY 워커는 카드에 적힌 것을 하고 멈춘다. plain은 제품 전체를 소유한 한 세션이라 만들다가 필요한 걸 발견한다 —
`core/money.mjs` `dates.mjs` `errors.mjs`를 스스로 만들고, 결과 보고에 "중복 임포트 버그를 만들다 발견해 고쳤다"고 썼다.
teams에는 **제품을 소유한 자리가 없었고**, 기획검토(revise)·개발검토(gate)·QA·AUDIT 어느 단계도
"rules가 113줄로 되나?"를 묻지 않았다. 6단계가 로컬 최적화를 막지 못했다. 이것이 이번 판에서 프로세스가 값을 못 한 지점이다.

## 2. 결정 — MCP 서버가 오케스트레이터다

```
사용자 세션 ── tm_run(request) ──▶ { run_id, docs_dir, verdict, summary(≤1k) }     한 번, 작게
                    │
              MCP 서버 (데몬, 그래프 소유)
                    ├─ 판단 노드 (size / shape / critique / accept / integrate 판정) → claude -p 단발
                    ├─ 작업 노드 (implement / test / draft / … )                   → claude -p (워크트리)
                    └─ 노드가 끝나면 다음 노드를 즉시 연다. 아무도 묻지 않는다.
```

- **상주 세션 0.** 매니저 폴링 루프, leader 프로세스, driver 프로세스 전부 제거. 모델 호출 수 = 노드 수.
- **상태는 서버·디스크에, 세션은 요약만.** 노드 출력·드라이버 로그·PRD·QA 리포트는 `task.json`·`docs_dir`에 있고 main에는 포인터가 온다.
  상세는 `tm_board` / `tm_ticket`으로 그 부분만 당긴다 — 카드 층이 정확히 이 용도다. **main 컨텍스트는 쌓이지 않는다.**
- **SSE에 대해.** Claude Code 세션은 서버 알림으로 깨어나지 않는다(모델은 자기가 도구를 부를 때만 움직인다).
  그러므로 "서버가 밀어준다"의 실질은 *세션이 상태를 들고 기다리지 않는다*이고, 그건 §4의 대기 모델로 푼다.
- 09-17 문서 §6 "TaskLeader는 항상 별도 프로세스"를 **뒤집는다.** 그 결정은 매니저 폴링을 전제로 leader를 하나 더 둔 것이었다.
  루프가 서버에 있으면 leader가 할 일이 없다.

### 그대로 사는 것

카드(`tickets.mjs`) · 다팀(`roles`, phase-Teams) · 중첩(자식 런 = 워크트리) · `allocation: balanced` · `KINDS` 체인 · gate 합의 · repair.
**전부 서버 쪽 코드다.** 바뀌는 건 *누가 루프를 돌리느냐* 하나다.

## 3. 자식 런은 체인만 돈다

실측한 자식 런:

```
PLAN   (plan 런)     plan → setgoal → critique → draft:U1 → review:U1 → gate:U1 → gate:goal → report    8노드  $4.14  파일 1
P1~P3  (develop 런)  plan → setgoal → critique → implement:U1 → test:U1 → gate:U1 → gate:goal → report   8노드  $4.1~4.3
P4     (develop 런)  … U1 U2 U3 U4 각각 implement/test/gate …                                             23노드 $12.11
AUDIT  (audit 런)    plan → setgoal → critique → draft → review → gate → gate:goal → report               10노드 $2.77
```

모든 팀이 같은 harness 그래프를 돈다(프랙탈). 이건 맞다. 문제는 **서브골이 하나인 자식 런에서 run-level
plan / setgoal / critique 3노드가 EPIC의 shape / critique를 반복**한다는 것. `gate:goal`도 서브골 하나면 `gate:U1`과 같은 판정을 두 번 한다.

**규칙**: 부모가 shape·critique를 끝낸 STORY가 여는 자식 런은 **KINDS 체인만** 돈다
(planning `draft → revise → gate`, develop `implement → test → gate`, qa `cases → execute → gate`). 껍데기(plan/setgoal/critique/gate:goal/report)는
자식이 다시 쪼개야 할 때(P4처럼 size가 그렇게 판단할 때)만 켠다. 기획 런 8→3, 단일 서브골 개발 런 8→3. 이번 판 기준 노드 호출 **약 60% 감소**, 프로세스 6단계는 그대로.

## 4. 대기 모델 — 세션은 기다리지 않는다

129분짜리 블로킹 도구 호출 하나는 안 된다(MCP 타임아웃, 세션 하나를 두 시간 묶음).

| | main 컨텍스트 | 용도 |
|---|---|---|
| **B. 열고 나가기** — `tm_run`이 run_id·docs_dir만 돌려주고 끝. 나중에 `tm_board`로 확인 | 2턴 | 대화형 기본 |
| **A. 바운드 롱폴** — `tm_wait(run_id, max_minutes)`가 그 사이 **노드 전이 델타만** 반환 | 호출 ~13번 × 수백 토큰, 거의 평평 | 대화형 편의 |
| **C. 세션 밖 대기** — `teams run` CLI가 서버를 띄우고 완료까지 기다림 | **0** | 헤드리스 / 벤치 |

벤치는 **C로 돌려야 공정하다.** 지금 벤치는 "기다리는 비용"을 teams에 물렸는데 그건 teams의 일이 아니다.
[[feedback-human-readable-status-surfaces]] — MCP 반환은 기계 모양, 사람이 읽는 건 CLI — 와 같은 원칙.

## 5. 검토가 카드 사이·밖을 본다 (§1b 해소)

지금 검토 노드는 전부 **카드 안**을 본다: `gate:U1`은 U1이 맞는지, `accept:Pn`은 Pn이 맞는지, AUDIT은 user_stories[] 대비 구현.
카드 사이(공통 모듈이 없다, 셋이 같은 걸 각자 만들었다)와 카드 밖(총량이 말이 안 된다, 스펙에 있는데 어느 카드에도 없다)은
아무도 안 본다.

- **integrate 판정에 "제품 소유자" 질문 추가**: 누락(스펙 항목 ↔ 카드 매핑에서 빠진 것), 중복(패키지 간 같은 책임), 총량(카드당 LOC/테스트가 스펙 복잡도 대비 그럴 법한가). 새 노드가 아니라 기존 integrate 노드의 Required-output에 항목을 더한다.
- **shape 출력에 `shared[]`**: 두 패키지 이상이 필요로 하는 것(core/money, errors)을 shape 단계에서 이름 붙여 별도 STORY로 만든다. 지금은 `touches[]`가 disjoint한지만 본다.
- **AUDIT은 user_stories 대비뿐 아니라 plain 기준선 대비**: 이 크기의 요청이라면 어느 정도가 나와야 하는가. 판정 근거로 남긴다.

세 항목 중 첫째가 핵심이고, 둘째·셋째는 첫째가 실제로 무엇을 잡는지 본 뒤 결정.

## 6. 측정 수정 (§0 해소)

- `score.mjs`: `<ws>/.harness-tasks/*/drivers/*.stream.jsonl` 및 하위 워크트리의 `.teams_output/broker/runs/*`의 드라이버 스트림을 비용·턴 합산에 포함. 과거 `*.score.json` 재계산.
- `goal_met`을 **양 팔에 동일 적용.** `decomposition`은 점수가 아니라 메타데이터.
- 프로세스가 사는 것을 재는 기준 추가: **스펙 누락 수**(스펙 항목 ↔ 구현 매핑), **검토가 잡은 결함 수**(gate 반려 중 실제 수정으로 이어진 것), **최종 보고의 거짓 주장률**(양 팔 같은 추출기), **회귀**(통합 후 깨진 것).
- 다음 두 판이 존재 이유를 판가름한다: **seam + plain 대조군**(독립 컨텍스트가 서로를 검증해야 잡히는 결함), **plain 천장(230k) 초과 크기**(plain이 못 담는 일).
- 두 판 모두 §4-C로 돌린다. `size`는 pinned 없이 자율.

## 7. 설정 정리

| 키 | 지금 | 결정 |
|---|---|---|
| `max_parallel_teams: 2` | 강제됨. 기본값이 낮아 4.8배 느림의 한 원인 | 기본값을 벤더 용량 기준으로 (`allocation`이 이미 용량을 안다) |
| `max_depth: 2` | 검증기만, 코드 없음 | 구현(자식이 다시 쪼개는 깊이 캡) 또는 삭제. §3 규칙이 들어가면 필요해진다 → 구현 |
| `interactive`, `human_gates`, `human_scope` | 검증기만, 코드 없음 | **삭제.** 사람 노드는 TODO이고, 들어올 때 다시 정의 |
| `size` pinned (벤치) | 프롬프트 강제 | 벤치에서 제거 |

## 8. 단계

1. **루프를 서버로** — `tm_run` / `tm_wait` 추가, 매니저 폴링·leader·driver 제거, 노드당 단발 호출, `teams run` CLI. §1a
2. **`score.mjs`** — 드라이버 합산, `goal_met` 동일 적용, 과거 점수 재계산. §6 (1과 독립, 병행 가능)
3. **자식 런 체인만** — §3 규칙. `max_depth` 구현. 1 위에서.
4. **제품 소유자 질문** — integrate Required-output 확장. §5
5. **재측정** — seam + 대조군, 천장 초과 크기. §6
6. **설정 정리** — §7 (1·3과 함께 자연히 정리되는 것은 그때)
7. TODO — 팀 종류 직접 정의(보안·디자인 = KINDS 항목 추가) / 가변 깊이 / 사람 노드. **5 결과 뒤.**

## 9. 반론과 리스크

- **"서버가 `claude -p`를 노드마다 띄우면 프로세스 기동 비용이 있다."** 지금도 driver마다 띄운다. 노드 수만큼 띄우면 횟수는 늘지만 각 호출이 짧고, 릴레이 3턴이 사라진 순감소가 더 크다. 실측으로 확인(단계 5).
- **"leader가 하던 판단(13 submit)은 누가 하나."** 그 13개는 size/shape/critique/accept 노드의 판정이다. 각 노드가 단발 호출로 스스로 답한다. leader는 그 답을 받아 `tm_submit`으로 옮겨 적었을 뿐이다.
- **"서버 데몬이 죽으면?"** 지금도 task.json이 진실이고 resume 경로(`spawnChildDriver(..., {resume: true})`)가 있다. 서버 재기동 시 running 노드를 다시 연다. 새 리스크가 아니다.
- **"체인만 도는 자식 런은 스스로 쪼개지 못한다."** size 판정이 자식 런에도 있다. 자식의 size가 S가 아니면 껍데기를 켠다(§3). `max_depth`가 그 재귀를 막는다.
- **"제품 소유자 질문이 integrate를 무겁게 한다."** 판정 노드 하나에 질문 셋. 이번 판 integrate는 1노드였다. 그 노드가 655 LOC를 보고 "적다"고 못 말한 게 문제였다.
- **"품질 기준을 새로 만들면 또 채점 버그가 난다."** 그래서 §6의 기준은 전부 *양 팔에 같은 추출기*를 쓰고, 첫 판은 손으로 대조한다.

## 10. 열린 논점 — 코드 전에 결정할 것

1. `tm_run`의 반환에 verdict를 넣나(완료까지 블로킹, C 전용) 아니면 run_id만(B)? — **B가 기본, C는 CLI가 `tm_wait`를 반복.**
2. 판단 노드의 `claude -p`는 어느 벤더로? — `allocation: balanced`가 review independence를 이미 계산한다. 판단 노드도 같은 규칙.
3. §3 규칙에서 "부모가 shape·critique를 끝냈다"의 신호는? — 자식 런 open 시 `parent_shaped: true` 플래그 하나. 그 플래그가 있으면 `plan/setgoal/critique/gate:goal`을 skipped로 생성.
4. `teams run` CLI의 위치 — `teams/scripts/run.mjs`. `harness`·`graph`에는 없는 것이라 형제 플러그인과의 대칭은 깨진다. 허용.
5. 09-17 문서 §7 "사용자 = human 노드"는 이 라운드에서 손대지 않는다. 사람 노드가 들어오면 그때 `tm_wait`가 자연스러운 접점이 된다(사람 차례면 델타에 `waiting_human`이 뜬다).

## 11. 한 줄

> 엔진은 맞게 만들었고, 그 위에 잘못된 층을 얹었고, 잘못된 자로 재서 잘못된 결론을 냈다. 고칠 것은 층과 자, 둘이다.
