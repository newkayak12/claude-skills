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

- **v0.7.3 — 재할당된 subgoal이 죽은 세대의 의존을 물려받지 않음**: 0.7.2의 첫 실전 런이 새 작업을
  확인해주고 — `implement`에 persona가 있고 `gate`에는 없음, kind에서 `develop:clean-code` /
  `develop:testing-workflow`+`completion:verification-before-completion` / `think:devils-advocate`가
  도착, 실행 노드 6개 전부 codex·기획과 판단 노드 7개 전부 호스트 — 그리고 유닛 테스트로는 볼 수 없는
  버그에 3/9으로 막혔습니다. `test:U3:2`가 거부되자 엔진이 의도대로 U3를 스스로 재할당했는데, 새로
  태어난 `implement:U3:3`의 의존이 `["critique", "gate:U1:1", "gate:U2:1"]` — spec 재시도가 이미
  superseded로 skip한 attempt-1 노드들이었습니다. 영영 ready가 되지 못해 subgoal 둘과 목표 게이트에
  도달하지 못한 채 blocked로 끝났습니다. `retrySubgoal`이 subgoal의 **가장 이른** head 노드에서 상류를
  읽고 있었는데, 그건 spec 재시도가 그 아래 subgoal들을 다시 전개하기 전까지만 옳은 노드입니다. 이제
  superseded되지 않은 가장 최근 head에서 읽습니다 — 한 세대 안의 모든 시도는 같은 기반 의존을 복사하므로
  같은 상류이고, 다만 실제로 살아 있는 세대의 것입니다.

- **v0.7.2 — 방법론은 kind에서 온다, 물어보는 방식이 실패했으므로**: 0.7.1의 첫 실전 런들이 모든
  subgoal에 `skills: []`, 모든 패키지에 `skills` 필드 자체 없음으로 돌아왔습니다. 같은 자리에서 요구한
  `persona`는 매번, 그것도 잘 채워졌는데도요("코드에서 설계 이력을 복원하는 편집자-아키비스트"). 차이는
  후보였습니다 — flow는 setgoal에 고를 persona 목록을 쥐여주는데, skills 계약은 형식만 주고 고를 것을
  주지 않았습니다. 무엇이 설치돼 있는지 볼 수 없는 에이전트는 플러그인 이름을 지어내지 않고, `[]`가
  정직한 답이었습니다. 그래서 목록을 `KINDS`로, 단계별로 옮겼습니다: `subgoal`은 implement에
  `develop:clean-code`, test에 `develop:testing-workflow`와 `completion:verification-before-completion`,
  `document`는 draft에 `write:doc-coauthoring`, review에 `write:writer-verification`, 그리고 양쪽 gate에
  `think:devils-advocate` — 이 재작성판이 대체한 세대가 하던 방식 그대로(런타임 선택이 아니라 프롬프트에
  박힌 이름). spec이 스스로 지정하면 작성 단계에서는 그쪽이 이깁니다(setgoal은 이 구체적 작업을 알고,
  kind는 작업의 형태만 아니까). 판단 단계는 언제나 family 것을 지킵니다 — 심판의 방법론은 작성자가
  고를 것이 아니므로.

- **v0.7.1 —같은 반론이 두 번이면 재시도가 아니라 재설계, 그리고 심판이 작성자의 정체를 넘겨받지
  않음**: 같은 서명(reason + 정렬된 gaps)으로 두 번 거부된 subgoal은 세 번째 시도를 열지 않고
  `setgoal`·`critique`로 **에스컬레이션**합니다 — 답을 실제로 바꿀 수 있는 라인으로, 계속 실패한
  내용을 싣고서. `goal-docs`가 그 사례입니다: 패키지 README가 "이 저장소엔 다른 문서가 없다"고
  정직하게 썼고 그건 합친 뒤에만 거짓이 되므로, 그 패키지 안의 어떤 시도로도 고칠 수 없었는데 예산은
  그 사실을 세 번 배우는 데 쓰였습니다. 목표 게이트에 하한선 `goal_threshold`가 생겼습니다(기본 90,
  런마다 지정 가능, 0이면 판정만으로 수락) — 70%에 accept하던 게이트는 부분 결과를 통과로 보고하던
  것입니다. spec에 `persona`와 나란히 subgoal별 `skills`가 들어가고, 패키지도 자기 것을 자식 run에
  넘깁니다. 그리고 대조가 찾아낸 버그: persona와 method가 체인의 모든 단계가 공유하는 브리핑 블록에
  있어서, 게이트가 "당신은 심판이지 행위자가 아니다" 두 줄 위에서 "이 모듈을 소유한 구현자로 행동하라"를
  지시받고 있었습니다. 이제 둘 다 작성 단계에만 갑니다.

  이번 것 대부분은 이 재작성판을 그것이 대체한 세대(`harness/engine/pipeline.js`)와 대조해서 나왔고,
  계획서에 그 표를 넣어 나머지를 값비싼 벤치 런으로 하나씩 재발견하지 않게 했습니다. 내용은 자랑스럽지
  않습니다 — 자동 재시도 루프, 정체 감지, 단계별 스킬 마운트, 목표 임계값이 전부 예전에 있었고
  인프로세스 루프에서 외부 세션이 모는 MCP 서버로 옮기며 사라졌습니다. 아직 남아 적어둔 것: 엔진에서
  `.claude/conventions/**`가 통째로 사라졌고, 매니저 자신의 `gate:goal`에는 임계값이 없으며,
  `sound: false` critique에는 여전히 자동 경로가 없고, 목표 게이트 repair 패스는 구현이 아니라
  Step 9 제안 상태입니다.

- **v0.7.0 — 품질 게이트가 거부하면 오케스트레이션이 스스로 재할당**: `gate`·`review`·`test`가 부정
  판정을 내면 노드를 실패시키고 런을 `blocked`로 둔 채 호출자가 `graph_retry`를 부르기를 기다렸습니다.
  그래서 거부가 권고에 그쳤습니다 — 세션이 안 부르면 거기서 끝이고, 게이트가 찾아낸 gap은 아무 데도
  가지 않았습니다. 이제 엔진이 거부 시점에 다음 시도를 직접 열고, `graph_retry`가 실었을 피드백을 그대로
  싣습니다(마지막 판단 노드의 reason·gaps·실패한 checks, 그리고 거부한 목표 게이트의 문구). 예산이
  소진되면 이전과 똑같이 `unreachable`로 정산합니다. submit 응답에 `reassigned`가 실려 호출자가 확인할
  수 있습니다. 재할당은 라우팅에도 걸립니다 — 같은 단계의 앞선 시도가 거부된 identity에 페널티를 줍니다.
  `goal-docs`가 예산 전부를 같은 작성자에게 같은 워크트리에서 같은 결론을 내게 하며 태웠기 때문입니다.
  판정만 재할당하고(아예 실행되지 못한 노드는 기존 경로 유지), 목표 게이트는 제외합니다(그 거부는 한
  subgoal이 아니라 통합 결과를 탓하므로). `graph_open({auto_reassign: false})`로 옛 동작 복원 가능하며,
  매니저가 자식 run 전부에 설정을 전달합니다.

- **v0.6.9 — 구동 세션이 직접 일하지 않고 던지게 만드는 hook**: 플러그인이 `PreToolUse` 게이트를
  함께 배포합니다(별도 등록 불필요). 프로젝트가 `.claude/graph-beta-dispatch.json`으로 opt-in하기
  전까지는 아무것도 하지 않고, 파일이 있으면 **task나 run이 하나도 열려 있지 않은 동안** 게이트 대상
  경로의 쓰기를 거부하면서 호출해야 할 것(`tm_open`)과 빠져나가는 법(파일 삭제, 또는 `allow`에 경로
  추가)을 함께 알려줍니다. 하네스가 관여 중이면 모든 쓰기를 통과시킵니다 — 노드는 써야 하고, 노드의
  fresh agent에게 쓰지 말라고 하면 런이 죽습니다. 이건 벤치가 이미 측정한 모양을 강제하는 것입니다:
  하네스를 잘 모는 세션은 `top-level edits 0`이고, 프로젝트를 직접 고치기 시작한 세션은 오케스트레이션을
  그만둔 것이며 — 그게 매니저의 존재 이유를 건너뛰는 경로이자 구동 세션 컨텍스트가 붓는 경로입니다
  (331턴에 507k 토큰, 작업 총비용의 약 55%). `paths`·`min_chars`·`allow`는 모두 선택이고, 하네스
  자신의 상태는 절대 게이트하지 않으며, 모든 오류에서 fail-open합니다 — 자기 파싱 실패로 세션을 막는
  hook은 없는 것만 못합니다.

- **v0.6.8 — 다른 벤더에서 노드가 실행됐고, 분담이 저절로 지켜짐**: Codex 로그인 상태에서
  `betas code-flat`이 실행 노드 7개(`draft`·`implement`·`test`)를 전부 `gpt-5.6-sol`에 보내고
  `critique`·`review`·`gate`는 전부 구동 호스트에 남겼습니다 — 누가 지시하지 않았는데 subgoal 4개에서
  **작성자와 리뷰어의 벤더가 갈렸습니다**. Codex는 7번 중 7번 유효한 단계 계약을 반환했고, 런은
  23/23 노드를 끝내 8/9 · $11.88(같은 arm을 전부 Claude로 돌린 $13.20 대비)이었으며, 도중에 Codex
  용량이 소진되자 `unavailable_vendors`에 기록하고 이유를 노드 `attempts`에 남긴 채 남은 작업을
  Claude로 넘겨 중단 없이 완주했습니다. 7건 모두 `changed_files_verified`가 `null`이고 모순 파일은
  0건 — 공유 워크트리 경로이고, 거기서 긍정 귀속은 설계상 성립하지 않습니다. 매니저는 자식 run을
  전부 `isolated`로 열고 쓰기 노드를 하나씩만 내주며, 이미 디스크에 있는 매니저 경로 런들의 집계는
  **49노드 전부 `('isolated', true)`** 입니다 — 남은 미측정은 메커니즘이 아니라 "executor가 Codex인
  isolated 노드" 하나로 좁혀집니다.

- **v0.6.7 — 매니저 단계에 방법론을 주고, 무엇을 썼는지 말하게 함**: 판단·기획 단계가 작업 전에
  로드할 스킬을 지정합니다 — `shape`는 `develop:domain-driven-design`과 `architecture-designer`
  (계약문이 이미 "단계가 아니라 소유권으로 쪼개라"고 합니다), `critique`는
  `think:devils-advocate`와 `cognition:assumption-extractor`(계약문의 단어가 "공격하라"),
  `accept`는 주장 대 증거를 가리는 `cognition:epistemic-reasoner`, `integrate`는 합쳤을 때만
  깨지는 것을 보는 `cognition:second-order-thinker`, `gate:goal`은
  `cognition:critical-thinking-workflow`. `size`는 의도적으로 없음 — 측정이고, 유일한 실패 모드가
  명령 대신 방법론에 손대는 것입니다. 사람을 위해 쓰인 스킬에는 headless 노드가 따를 수 없는 것이
  둘 있습니다(자기 출력 템플릿, 그리고 사람 파트너에게 말하는 "what you do" 절) — 그래서 브리핑이
  단계 계약이 둘 다 이긴다는 것, 설치돼 있지 않은 스킬은 말없이 건너뛴다는 것, 어떤 노드도 질문해서는
  안 된다는 것을 명시합니다. 모든 계약이 `skills_used`를 반환합니다 — 사용 여부를 관찰할 수 없는
  방법론은 평가할 수 없기 때문입니다. 단계별 교체는 `tm_open({skills: {...}})`, 계약문만으로 돌리려면
  `skills: false`. **아직 미측정**: 비용값을 하는지. 기준선은 `goal-code` 7/7 · 130분 · $44.74이고,
  심판 노드는 이미 작업 총비용의 약 40%입니다.

- **v0.6.6 — 점수가 하네스 자신의 판정과 모순될 수 없게**: `goal-docs`는 `integrate` 2회 실패,
  패키지 blocked, `unreachable` 3개로 끝났는데(정산 경로, 설계대로) 벤치 채점기는 integrate가
  거부한 바로 그 통합 워크트리에 **8/8**을 줬습니다 — LLM accuracy 심판까지 통과. `task.json`에
  state 필드가 없어 채점기가 판정 자리에 `-`를 찍고 있었고, 이제 노드에서 판정을 유도해
  (`delivered` / `settled-failure` / `incomplete` / `not-delivered`) 점수 옆에 출력합니다.
  드라이버 결함 2건 동반: 한도 메시지가 `hit your **weekly** limit`인데 정규식이 `session|usage`만
  알아서 작업 중인 job을 done 처리했고, 같은 워크스페이스를 두 번째 드라이버가 집으면서 resume
  번호를 0부터 다시 세어 첫 드라이버의 스트림을 덮어썼습니다(그 세션의 비용·턴이 이후 모든 합계에서
  소실 — $53.38이 $22.89로). `goal-docs`가 실패로 증명한 것: **seam 결함은 패키지를 격리해
  재시도해서는 고칠 수 없다** — `tm_retry({package_id})`는 그 문장이 여전히 참인 워크트리로 작업을
  돌려보냅니다. 수리 경로가 없고, 이건 졸업을 막는 항목입니다.

- **v0.6.5 — 벤치 드라이버가 죽은 세션을 끝난 세션으로 오인하지 않고, 동일 위상 비교가 완성**:
  외부에서 죽은 세션(메모리 부족 kill, SIGKILL)은 `result` 이벤트를 남기지 않는데 `drive.sh`가
  그 빈 텍스트를 "정상 종료"로 읽어, 두 런이 죽는 순간 done으로 표시됐습니다. 이제 `result`
  이벤트가 없는 스트림은 kill로 보고 곧바로 resume하며, 세션을 열지 못한 resume은 재시도 예산을
  순식간에 소진하는 대신 해당 job을 중단합니다. `resume.sh`는 워크스페이스 이름
  `<case>-<arm>-<label>`을 왼쪽부터 파싱해 `goal-code-beta-g1`이 case `goal`이 되었고, 모든
  한-줄-목표 resume이 없는 요청 파일에서 죽었습니다 — 이제 오른쪽부터 파싱합니다. graph 1.7.1에서
  고친 `$TMPDIR`/`private/var` 단언이 여기엔 남아 있어 함께 수정. `betas docs`가 들어오면서
  (9/9 · 68분 · $21.79 · 31 agents) 두 동일 위상 쌍이 모두 측정됐습니다: stable의 9/9 · $18.10
  대비 beta는 20% 더 쓰고, 그 20%를 실제 `document` flow에 씁니다 — `draft` 9 · `review` 9 ·
  `gate` 10, `implement`은 0. stable은 document kind가 없어 같은 요청을 implement/test로
  돌렸습니다. 엔진 오버헤드는 엔진의 것이고, 라운드 1의 34배는 beta가 아니라 매니저 위상의 것입니다.

- **v0.6.4 — shape 계약문이 브랜치에 대해 사실을 말하고, 벤치가 매니저의 존재 이유인 층을
  측정**: 첫 한-줄-목표 런의 critique 노드가 shape 계약문이 여전히 모든 패키지가 "현재 HEAD에서
  갈라진다"고 말하는 것을 잡았습니다 — 의존 패키지는 0.6.0부터 의존 대상의 전달 브랜치에서
  갈라지는데, 낡은 문장 때문에 critique가 사실은 핵심이던 의존을 반대했습니다. 수정. 벤치에
  `betas` arm(size를 측정에 맡긴 graph-beta: 단일 런, stable과 같은 위상 — `code`에서 8/9 ·
  $13.20 vs stable 9/9 · $13.27)과 `goal-code`/`goal-docs` 케이스(한 줄 목표만 주고 분할·계약·
  문서 세트를 하네스에 맡김)가 생겼고, 채점기는 목표 대비 결과와 매니저 분할의 자체 타당성을
  판정합니다. 첫 관찰: shape가 한 줄 목표를 사람이 상세 케이스에 써둔 것과 같은 패키지 넷으로
  나눴습니다. 어느 라운드에도 아직 측정 안 된 것: 교차 벤더 dispatch — 벤치 머신에 codex
  로그인이 없어 모든 노드가 Claude로 돌았습니다; 가정하지 않고 다음 라운드로 기록.
- **v0.6.3 — 처음으로 완주한 매니저 런, 그리고 가는 길에 깨진 것들**: size L 태스크 둘이 `report`까지
  끝까지 돌았습니다(`scripts/bench/README.md`, Results). 거기까지 가며 매니저 결함 셋을 더 찾아 각각
  테스트와 함께 고쳤습니다: fold의 `git add -A -- . ':!.harness-run'`은 프로젝트 `.gitignore`에
  `.harness-run/`이 있으면(보통의 경우이고, 이제 모든 테스트 리포도 그렇습니다) exit 1 — 수용된
  자식 둘을 커밋하지 못했습니다; 이제 전부 스테이지한 뒤 `.harness-run`을 빼냅니다.
  `tm_retry({package_id})`는 shape에 없는 id를 받아 유령 패키지를 열었습니다; 이제 목록과 함께
  거부합니다. 그리고 검사에 실패한 `integrate`는 탓한 패키지가 재시도·수용된 뒤에도 failed로
  남았고 — 목표 게이트는 그 뒤에서 영원히 대기, 그래프 엔진의 거부된 `gate:goal`과 같은 막힘 —
  이제 패키지 재시도가 같은 accept들 위에 새 `integrate:N`을 열고 목표 게이트를 그 뒤로 옮깁니다.
  같은 릴리스: `resume.sh`와 `drive.sh`가 중단된 워크스페이스를 새 세션에서 이어가고 사용 한도
  리셋을 넘어 잠들었다 깨어납니다; 채점기는 워크스페이스를 구동한 모든 세션을 합산하고, 벽시계
  시간은 러너의 스탬프에서, 구동 세션의 도구 호출은 fresh agent의 것과 분리해 셉니다. 측정:
  매니저는 두 케이스 모두 plain 세션과 같은 9/9를 비용 34× / 12×로 냈습니다. 돈이 어디로 갔고
  무엇을 할지는 플랜 문서(Step 7). 스스로 L로 측정되는 요청이 매니저를 통과하기 전까지 매니저는
  experimental입니다.
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
