# graph-beta — 한국어

[English](README.md) · **한국어**

[`graph`](../graph/KOR.md)의 베타 라인입니다. `graph`는 안정 엔진으로 남아 수정만 받고, 아래
내용은 전부 여기서 먼저 만들어져 실제 런에서 검증된 뒤에만 `graph`로 올라갑니다.

같은 브로커, 같은 도구 여섯 개, 같은 스킬 — 차이는 이것뿐입니다:

| | `graph` (안정) | `graph-beta` |
|---|---|---|
| MCP 서버 | `graph-engineering` | `graph-beta-engineering` + `task-manager` |
| 런 파일 | `.harness-run/broker/` | `.harness-run/broker-beta/` |
| 스킬 | `graph:install`, `graph:orchestrate` | `graph-beta:install`, `graph-beta:orchestrate`, `graph-beta:develop`, `graph-beta:document` |
| 버전 | 1.x | 승격 전까지 0.x |

**한 프로젝트에 둘을 함께 켜지 마세요.** 두 서버 모두 `graph_*` 도구를 노출하므로, 각각 두 개씩
보이는 세션은 자기가 어느 런에 있는지 구분하지 못합니다.

## 왜 베타 라인인가

안정 엔진은 한 가지 모양의 일에 맞춰져 있습니다: 요청이 서브골이 되고, 서브골마다 **파일을 바꾸고**,
git 워크트리에 대해 **명령을 실행해** 검증합니다. 코드엔 맞는 모양이고, 설계 문서·조사 정리·여러
워크트리에 걸쳐 여러 런으로 나눠야 할 만큼 큰 요청엔 틀린 모양입니다 — 그리고 다른 런을 관리하는
런이라는 개념이 없습니다.

세 가지를 이 순서로, 각각 앞 단계의 테스트 뒤에서 추가합니다:

1. **kind.** 서브골이 어떤 종류의 일인지 선언하고, kind가 어떤 노드 체인으로 펼쳐질지 정합니다.
   `subgoal`(코드)은 지금 그대로 `implement → test → gate`. `document`는 `draft → review → gate`:
   저자 ≠ 리뷰어, 루브릭 기반, 워크트리 변경이 없어도 실패가 아님. 한 스펙에 kind를 섞을 수
   있습니다 — "기능 구현하고 설계 문서 갱신"이 런 하나입니다.
2. **flow별 진입.** `graph-beta:orchestrate`는 아무것도 고르지 않는 진입점으로 남습니다: `plan`이
   크기를 재고 flow를 정합니다. `graph-beta:develop`과 `graph-beta:document`는 얇은 수동 진입 —
   트리거 단어, `flow` 기본값, 페르소나 집합 — 이고 같은 루프에 넘깁니다. 루프는 복제되지
   않습니다.
3. **TaskManager.** 중·대규모 요청용으로 이 플러그인 안의 두 번째 MCP 서버 `task-manager`.
   크기를 재고, `touches[]`와 의존성을 가진 패키지로 나누고, 패키지마다 자식 graph 런을 자기
   워크트리에 엽니다 — **여는 주체는 브로커이고 노드가 아닙니다** — 그리고 자식의 판정을 수용하고
   워크트리를 통합하고 보고합니다. `mcp/graph.mjs`를 라이브러리로 재사용하며(DAG, 간선 타입,
   재시도, 확정 실패) 자식 런 파일은 읽기만 하고 쓰지 않습니다. 작은 요청은 이 층을 통째로
   건너뜁니다.

설계와 단계 목록: [`docs/plans/2026-09-11-graph-beta-taskmanager.md`](../docs/plans/2026-09-11-graph-beta-taskmanager.md).

## 상태

- **v0.6.2 — 모델 티어는 호스트가 선언한 목록에 맞춰 해석, size는 핀 가능**: 두 번째 e2e
  라운드는 `plan`을 넘었지만 `implement`/`draft` 노드가 전부 막혔습니다 — 실패 노드 0개인 채로.
  실행 단계 기본값은 티어 이름(`sonnet`), 세션은 정식 ID(`claude-sonnet-5`)를 선언했고, 검사는
  문자열을 비교했습니다. 구동 세션의 유일한 출구는 두 번째 `graph_open`이었고 — 고아 런과
  스펙 재작업이 두 번. 이제 `resolveNativeModel`이 티어를 선언 목록에 대응시키고(`sonnet` ~
  `claude-sonnet-5`), 선언되지 않은 티어는 호스트 모델로 돌되 라우팅 이유에 치환을 적습니다 —
  보이게, 조용히 말고, 이름 문제로 런이 죽는 일 없이. `loop.md`는 `vendor-failure` 막다른 길을
  명명하고 두 번째 open을 금지합니다. 같은 라운드에서 monorepo 픽스처 둘도 타당한 이유로 S로
  측정됐습니다(테스트 스크립트 하나, 커밋 하나, 소유 경계 없음): `size`는 패키지 수가 아니라
  build unit을 읽고, 매니저 경로엔 도달하지 못했습니다. `tm_open({size: "L"|"S"})`가 `flow`처럼
  size를 핀합니다 — 사용자가 직접 나누라고 말한 경우 — size 노드는 `pinned`로 기록됩니다. 벤치의
  beta arm은 이제 그 말을 싣고, 없이 돈 런은 위임 경로 데이터로 남깁니다.
- **v0.6.1 — 호스트 자신의 모델은 항상 선택 가능, 그리고 벤치**: 첫 e2e 라운드에서 구동
  세션이 자신을 `claude-opus-5[1m]`(fresh agent 선택기에 없는 컨텍스트 변형)로 보고했고,
  `graph_open`이 `plan`에서 `native host cannot select model`로 막혔습니다 — 그 순간 호스트가
  실제로 돌고 있던 모델에 대한 vendor failure. 이제 검사는 `host_model`을 무조건 통과시킵니다:
  모델 지정 없는 fresh native agent는 그 모델을 상속합니다. 같은 라운드에서 flat 요청 둘이 모두
  S로 측정됐습니다 — 빈 단일 패키지 리포에는 `size`가 볼 build unit이 없습니다 — 그래서
  `scripts/bench/`에 L로 측정되는 monorepo 픽스처 둘(`code`: 워크스페이스 패키지 넷, `docs`:
  문서화할 패키지 셋), 위임 경로용 flat 픽스처, 한 arm(`beta`, `stable` graph 1.x, `none`)을
  headless 세션으로 돌리는 러너, 채점기(정적+실행 기준, docs용 LLM 판정 정확성 검사 하나, 최상위
  transcript에서 뽑는 세션 비용과 스킬 준수 카운트)를 넣었습니다. 픽스처 메모: 첫 라운드의
  `npm test` = `node --test test/`는 Node 22에서 실패합니다(디렉터리 인자); 이제 `node --test`.
  결과는 라운드가 끝날 때마다 `scripts/bench/README.md`에 적습니다.
- **v0.6.0 — integrate와 repackage**: git 작업은 매니저의 것이라, 충돌은 노드의 주장이 아니라
  매니저가 본 사실입니다. 수용된 자식을 접을 때 워크트리를 패키지 브랜치에 커밋합니다(런 상태
  디렉터리는 제외). `deps`가 있는 패키지는 첫 의존 패키지의 브랜치에서 갈라지고 나머지는 머지되어
  들어옵니다 — 머지 시점에 다시 발견하는 대신 전달된 작업 위에서 시작하고, 의존 둘이 서로
  충돌하면 자식을 열기 전에 그 dispatch가 실패합니다. `integrate`가 준비되면 `tm_next`가 모든
  패키지 브랜치를 의존 순서로 통합 워크트리에 머지하고 머지 커밋을 기록합니다. `integrate`
  에이전트는 합쳐진 트리에서 목표 수준 검사만 돕니다. 머지 충돌은 노드를 `conflicts`와
  `conflicting_packages`(머지되던 것, 그다음 선언된 `touches`로 본 소유자)로 실패시키고,
  `tm_retry({repackage: [...]})` — 미결이었던 질문의 답 — 이 그 패키지들을 하나로 합치거나 서로
  의존하게 하라는 지시와 함께 reshape합니다. 유지된 id는 워크트리를 재사용합니다. 같은 내용의
  편집은 git 규칙상 조용히 머지된다는 걸 테스트가 배워야 했습니다. 매니저 13건; 세 스위트 합계
  112개 통과.
- **v0.5.0 — 모든 진입에 size 게이트**: `graph-beta:orchestrate`·`develop`·`document`가 모두
  `tm_open`으로 열고, 새 에이전트 하나가 `size`를 돕니다. `delegate`가 있으면 태스크는 이미
  사라졌고 스킬은 `graph_open(delegate.args)`와 단일 런 루프로 이어갑니다. 없으면 새
  `orchestrate/references/manager.md` 루프: `tm_next`의 children을 자식 워크트리에서 평소의
  `graph_*` 루프로 돌리고, payload 없는 `tm_submit`으로 접고, 패키지별 `tm_retry` 또는 reshape.
  고정된 진입 flow는 사이징을 통과해도 유지되고(`size`가 뭐라 해도 진입이 이김),
  `delegate.args`는 `graph_open`에 그대로 들어갑니다 — 두 서버를 가로질러 끝까지 테스트.
  110개 통과.
- **v0.4.0 — TaskManager 서버, 자식 런은 읽기만**: `mcp/taskmanager.mjs`를 브로커 옆에
  `task-manager`로 등록. `tm_open`은 `size → shape → critique`를 `~/.harness/tasks/<task_id>/`
  아래에(프로젝트 밖) 만듭니다. `size`가 S면 태스크를 지우고 `delegate: {tool: "graph_open", args}`를
  돌려줍니다 — S 요청은 매니저 상태를 남기지 않습니다. L이면 `shape`(패키지: `brief`, `acceptance`,
  `touches[]`, `deps[]`; 겹치는 touches·없는 dep·사이클·패키지 하나짜리를 검증) → 패키지마다
  `[dispatch → accept]` → `integrate` → `gate:goal` → `report`. 준비된 `dispatch`는 `tm_next`에서
  서버가 직접 실행합니다: 프로젝트 HEAD에서 `git worktree add`, 그 안에 `graph.mjs`의 `createRun`을
  라이브러리로 불러 격리된 자식 graph 런을 열고, 패키지 brief를 request로, 패키지 계약(과 의존
  패키지의 보고서)을 context로 넘깁니다. 세션은 평소의 `graph_*` 도구로 자식을 돌리고, dispatch에
  `tm_submit`하면 자식 파일을 읽어 goal-gate 판정과 보고서를 접어 넣습니다 — 파일은 바이트 하나
  안 바뀝니다(테스트로 확인). 재시도는 같은 워크트리에 gaps를 실은 새 자식을 열고, 예산 소진은
  하류를 확정해 report를 풉니다. 서버를 재시작해도 파일에서 이어가며 진행 중인 dispatch를
  회수하지 않습니다. 진행 중 graph 엔진 자체의 버그 발견: 거부된 `gate:goal`이 서브골 재시도 뒤
  다시 판정되지 않아 수정이 들어간 채 런이 멈췄습니다 — 이제 살아있는 서브골 gate들 위에 새
  `gate:goal:N`이 열리고 report가 그 뒤로 옮겨집니다. 매니저 10건 + 엔진 1건; 세 스위트 합계
  109개 통과.
- **v0.3.0 — flow와 진입 스킬**: `graph_open({flow, mixed})`. `flow: "auto"`(`graph-beta:orchestrate`
  기본값)는 선택을 `plan`에 맡기고, plan 계약은 이제 `flow`(develop | document), `size`(S | L),
  그리고 측정에 쓴 명령을 반환합니다. 아무 말 없는 plan은 develop으로 떨어지되 런에
  `flow_source: "default"`로 기록되어 결정인 척하지 않습니다. `graph-beta:develop`과
  `graph-beta:document`는 얇은 수동 진입 — 트리거 단어, 고정된 `flow`, 페르소나 집합 — 이고
  하나의 루프(`orchestrate/references/loop.md`로 이동)에 넘깁니다. flow는 서브골이 이름 붙이지
  않은 kind를 공급하고, `mixed: false`면 다른 kind는 setgoal에서 스펙 결함이 됩니다.
  `graph_next`/`graph_status`가 `flow`와 `size`를 보고합니다. 신규 3건, 98개 통과. `size: L`은
  기록만 되고 아직 행동하지 않습니다.
- **v0.2.0 — `document` kind**: 서브골이 `kind: "document"`를 선언하면 implement/test/gate
  대신 `draft → review → gate`로 펼쳐지고, 한 스펙에 kind를 섞을 수 있습니다. `draft`는 산출물을
  쓰고 implement와 같은 워크트리 교차검증을 받되, 빈 파일 목록은 모순이 아니라
  `changed_files_verified: null`(`document-unchanged`)입니다 — 핸드오프에 담긴 노트는 git이
  아니라 리뷰어가 판정합니다. `review`는 추론 노드: 읽기 전용 샌드박스, 수용 항목마다 근거
  문장을 인용하거나 빠진 것을 명시, 판정은 `verified`. 저자 ≠ 리뷰어는 브로커가 신원을 볼 수
  있는 곳에서 강제됩니다: draft를 쓴 vendor+model로 라우팅된 review는 거부되고 pending으로
  남습니다(판정에 `reviewer_independence: distinct-identity | unverifiable-self`). balanced
  할당에선 자동으로 만족 — draft는 peer로, review는 host에 남습니다. review나 test가 실패한
  뒤의 재시도는 gate의 gaps만이 아니라 그 노드의 checks를 피드백으로 가져갑니다. 신규 5건,
  95개 통과.

- **v0.1.0 — 포크 + kind 테이블**: graph 1.7.0(간선 타입, 확정 실패)에서 복사. `expandSubgoals`와
  `retrySubgoal`이 서브골의 노드 체인을 하드코딩된 implement/test/gate 대신 `KINDS` 테이블에서
  만들고, `subgoal.kind`를 그 테이블로 검증합니다. kind는 아직 `subgoal` 하나이고 89개 회귀
  테스트가 그대로 통과합니다 — 이 단계의 목적이 그것입니다: 이음새는 생겼고 동작은 움직이지
  않았습니다. 새 케이스 하나: 알 수 없는 `kind`는 다른 스펙 결함처럼 setgoal에서 실패합니다.

## 설치

`graph-beta@newkayak12-claude-skills`를 설치하고 `graph-beta:install`로 `graph_*` 도구 여섯 개가
있는지 확인합니다. 소스 체크아웃이면 프로젝트 `.mcp.json`에 `mcp/broker.mjs`를
`graph-beta-engineering` 이름으로 등록합니다. `graph-beta:install`이 그 항목을 보여줍니다.

## 나머지 전부

도구, 라우팅, 판정, 벤더, 용량 복구, 원장은 안정판과 같습니다 — [`graph/KOR.md`](../graph/KOR.md)를
읽으세요. 안정판 수정은 여기로 포워드 포트되고, 베타 작업은 승격 전까지 백포트되지 않습니다.
