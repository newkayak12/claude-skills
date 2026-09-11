# graph — 한국어

[English](README.md) · **한국어**

하네스 흐름을 위한 그래프 엔지니어링입니다. 로컬 MCP 서버가 중개하고, 메인 세션은 오케스트레이션만
합니다. 상태·라우팅·실행·판정은 그래프 엔진이 소유해요.

`harness`의 형제 플러그인이며 대체물이 아닙니다. **harness**는 6단계 추론 계약을 소유하고,
**graph**는 "이 노드를 누가 실행하는가", 그리고 "그 결과가 워크트리와 대조해도 살아남는가"를
소유합니다.

## 왜

기존 정적 Workflow 엔진은 벤더 CLI를 Bash로 몰기 위해 노드마다 전송용 서브에이전트를 띄워야
했습니다. 장시간 프로세스를 기다리는 서브에이전트는 폴링밖에 할 수 없고, cache-read는 턴 수에
비례해 늘어납니다. 실제 런 하나에서 같은 작업량을 측정한 결과:

| 노드 안의 셸 턴 수 | cache-read 토큰 |
|---|---|
| 4 | 227,323 |
| 12 | 1,281,319 |
| 17 | 1,965,390 |

그 런에서 전송 계층이 추론 계층보다 비쌌습니다. MCP 호출은 한 턴이고 블로킹이므로 노드가 폴링을
**할 수 없습니다** — 프롬프트로 말리는 게 아니라 구조적으로 실패 모드가 제거됩니다.

## 설치

마켓플레이스 플러그인을 설치하고 `graph:install`로 연결을 확인하세요:

```text
/plugin install graph@newkayak12-claude-skills
```

소스 체크아웃이라면 `graph:install`이 아래 직접 등록을 대신 병합해 줍니다:

```json
{
  "mcpServers": {
    "graph-engineering": { "command": "node", "args": ["<plugin root>/mcp/broker.mjs"] }
  }
}
```

런타임 의존성 없음, Node 18+.

## 상태

- **v1.7.0 — 간선 타입과 확정 실패**: 의존성은 한 가지 뜻뿐이었습니다 — "성공했어야 함". 그래서
  `report`는 `gate:goal` 뒤에 매달려 있었고, 재시도 예산이 소진된 서브골 하나가 런을 영원히
  `blocked`로 남겼습니다 — 통과한 서브골의 작업은 리포트조차 안 나왔습니다. 이제 간선은 두
  종류입니다. `deps`는 데이터 의존(dep이 `done`이어야 함), `after`는 순서만 강제하는 Make의 `|`
  prerequisite(dep이 끝났으면 됨, 통과는 불필요). `report`는 goal gate에 `after`로 매달립니다.
  `graph_retry`가 예산 소진을 만나면 막다른 길을 돌려주는 대신 실패를 확정합니다: 죽은 노드의
  산출물을 데이터 간선으로 필요로 하는 모든 노드가 이유와 함께 전이적으로 `unreachable`이 되고,
  하류에서 이미 실패한 노드도 final이 되며, 순서 간선으로는 전파되지 않습니다. goal gate가
  `unreachable`이 되고 `report`가 ready가 되어, 런은 report 노드가 쓴 부분 성공 보고서와 함께
  `complete`로 끝납니다. 재시도가 남은 단순 `failed`는 아무것도 확정하지 않습니다 — 리포트가
  재시도보다 먼저 달릴 수 없습니다. 스펙은 서브골에 `after: [id]`를 줄 수 있고 `deps`와 같은
  자기참조/미존재/사이클 검사를 받습니다. `graph_retry`는 거절 시 `unreachable[]`과 다음 ready
  노드를 돌려주고, `graph_status`는 `after`를 보여주며 `unreachable`을 셉니다. 함께 고친 것: 스펙
  재시도 후 재구성된 리포트(`report:2`)가 런 전체 없이 브리핑되던 문제, critique의 `blocking` /
  `problems`가 goal gate와 report에 전달되지 않던 문제.
- **v1.6.3 — 한국어 README**: 문서만 추가됐습니다. 스킬·브로커 동작 변경 없음.
- **v1.6.2 — 런이 스스로를 보여준다**: 1.6.1은 진행 상황을 평문 라인으로 찍었습니다. 라이브 진행
  표시면(progress surface)이 있는 호스트는 이미 더 좋은 걸 갖고 있고, 그래프 런은 정확히 그
  표시면이 원하는 모양입니다. 이제 스킬이 노드 그래프를 호스트의 태스크 목록으로 미러링합니다 —
  준비된 노드마다 태스크 하나, 디스패치 시 `in_progress`, 판정 시 `completed` — 표시면이 없는
  호스트를 위해 평문 라인은 폴백으로 남습니다. 어느 쪽이든 어휘는 똑같이 작고(`node_id`,
  벤더/모델, 상태, 짧은 `reason`), 규칙도 그대로입니다: **판정에서 쓸 수 없는 줄은 쓰지 않는다.**
- **v1.6.1 — 진행 중 보고, 그리고 report 노드가 앉을 자리**: 1.6.0은 `report`를 상대 벤더로
  라우팅해 놓고도 드라이버의 출력 템플릿이 런을 서술하게 남겨뒀습니다. 그래서 그래프 노드의
  페이로드가 갈 곳이 없고, 컨텍스트 압박을 받는 드라이버는 조용히 다시 서술하게 됐어요. 이제
  템플릿이 그 노드를 그대로 옮기는 `### Report` 섹션으로 끝나고, 런의 진술은 report 노드가
  쓴다고 mandate에 명시했습니다. 루프는 노드마다 한 줄(`node_id`, 벤더/모델, 상태, 짧은 이유)을
  찍어 긴 런이 도는 동안에도 보이게 하고, 그 줄은 드라이버가 이미 들고 있는 판정에서만 씁니다 —
  페이로드를 열어서 쓰지 않아요. `references/`와 다시 벌어졌던 중복도 정리했습니다. QA:
  Usefulness/Authoring/Output-Quality PASS, MCP NONE, Weight OK, eval delta **+0.42**
  (12/12 vs 7/12)로 기준선 +0.375 상회. 그리고 드라이버에게 브로커가 동시 `implement` 노드를
  직렬화해 주지 않는다는 사실을 분명히 알립니다 — `readyNodes`는 의존성이 채워진 노드를 전부
  돌려주므로, 그중 둘을 한 워크트리에서 떼어놓는 건 호출자 몫입니다.
- **v1.6.0 — 리포트는 상대가 쓰고, 진행 상황은 물어볼 수 있다**: `report`가 런을 구동하지 *않은*
  벤더로 라우팅됩니다. 런의 자기 진술을 그 런의 드라이버가 쓰지 않게 하려는 거고, 여전히 추론
  작업(읽기 전용 샌드박스, 호스트로 폴백하면 `host_model`)입니다. `graph_status`는 이제 `run_id`
  없이도 호출됩니다: 디렉터리의 모든 런을 상태·카운트와 함께 나열하고, 지금 돌고 있는 노드의
  벤더·경과 초, 마지막으로 끝난 노드까지 보여줘요. id를 잃은 리드나 옆에서 들여다보는 두 번째
  운영자도 트랜스크립트 없이 런을 찾을 수 있습니다. 1.5.7에서 첫 완전 크로스벤더 E2E가 8/8로
  완료됐고, Codex가 `danger-full-access`에서 구현·테스트하며 `changed_files_verified: true`를
  받았습니다.
- **v1.5.7 — 정직한 절대 경로, 옵트인 풀 액세스**: 워크트리 대조가 실행자의 절대 경로
  `changed_files` 주장을 git의 상대 경로 출력과 비교해서, 브리핑에 적힌 경로를 그대로 쓴 정직한
  노드를 전부 실패시켰습니다. Claude는 Codex처럼 런 단위 옵트인으로 `danger-full-access`
  (`--permission-mode bypassPermissions`)를 얻었고, 기본값은 그대로 프로젝트 권한 설정을 따릅니다.
- **v1.5.6 — eval이 잡아낸 두 구멍 닫기**: blocked mandate가 게이트를 넘어가는 걸 "하는 것"만이
  아니라 "제안하는 것"까지 금지하고, `isolated: true`는 유저가 원한다고 말한 게 아니라 실제
  워크트리를 요구합니다.
- **v1.5.5 — orchestrate QA 후속**: 루프가 `cwd`를 실어 재시작한 클라이언트도 런을 찾을 수 있고,
  weight 체크가 찾아낸 마지막 중복이 사라졌습니다(브리핑 규칙과 랭킹 문장은 `references/`에만).
- **v1.5.4 — orchestrate QA 통과**: 스킬이 self 노드 디스패치 계약(반환된 모델의 fresh 에이전트,
  브리핑 경로만, JSON 그대로 중계)을 명시하고, 준비된 self 노드를 벤더 노드에서 블로킹하기 전에
  팬아웃하며, 판단을 가르는 규칙을 Standing Mandates로 올리고, `references/`와 중복된 산문을
  버리고, 트리거 문구를 이름으로 답니다.
- **v1.5.3 — orchestrate 스킬 분할**: 라우팅 상세, 핸드오프 의무, 용량 복구가
  `skills/orchestrate/references/`로 이동했고, 스킬은 루프·mandate·판정 계약을 유지합니다
  (275 -> 186줄).
- **v1.5.2 — 원자적 용량 리셋**: 어차피 거절될 `graph_retry`가 용량 제외를 먼저 지우는 일이
  없어졌고, 평범한 프로브 실패가 용량 제외로 세탁되지 않습니다.
- **v1.5.1 — 프로브 시점 용량 판정**: 사용량 한도로 거절된 준비 프로브를 "고장난 벤더"가 아니라
  "소진된 용량"으로 분류해 런에 기록하고, 중단된 노드를 지목할 필요 없이
  `graph_retry({reset_capacity:true})`로 해제합니다.
- **v1.5.0 — 자동 할당과 용량 복구**: 균형 라우팅이 추론은 구동 호스트에 두고, Implement/Test는
  반대 벤더의 효율 모델을 선호합니다. Claude용 fresh-session CLI 어댑터가 추가됐고,
  Fable/Astra는 상속 기본값에서 제외됩니다(명시 요청은 계속 지원). 사용량 한도로 중단되면
  체크포인트와 부분 파일을 유지한 뒤 사용 가능한 다른 벤더로 라우팅합니다. 토큰·비용·턴 상한은
  새로 부과하지 않습니다.
- **v1.4.0 — 호스트 중립 오케스트레이션 계약**: 역할마다 fresh context, 공유 태스크 디렉터리와
  영속 핸드오프, 태스크 범위로 자른 Implement/Test 입력, SetGoal/QualityGate 재시도가 스킬의
  명시 요구사항이 됐습니다. 두 AI 실행자가 모두 가용하면 요청자 정체성이 아니라 태스크 적합도와
  관측된 비용으로 라우팅합니다. 이 릴리스는 브로커가 아니라 지침을 바꿉니다.
- **v1.3.0 — 현재 세션 실행**: `graph:orchestrate`가 모든 스테이지에서 활성 Codex/Claude 세션과
  그 네이티브 도구·현재 모델을 기본으로 씁니다. 외부 벤더 라우팅은 선택이며, Codex CLI나 고정
  모델이 필수가 아닙니다.
- **v1.2.0 — Claude/Codex 혼합 오케스트레이션**: 추론·게이트·리포트는 Claude 세션에 두고
  implement/test는 Codex를 요구합니다. 노드가 선택한 모델이 Codex 준비 프로브에도 전달되고
  모델 단위로 캐시되므로, 전역 기본값이 잘못돼 있어도 모델을 명시한 런이 거절되지 않습니다.
- **v1.1.1 — `graph:orchestrate`가 Codex 우선**: 평범한 스킬 구동 런이
  `vendor: "auto", candidates: ["codex"]`로 열리므로 준비 프로브를 통과하면 번들 어댑터가 실제로
  쓰이고, 불가하면 눈에 보이게 `self`로 내려갑니다.
- **v1.1.0 — 스테이지별 라우팅**: `graph_open`이 `model`(런 기본값)과 `policy`(스테이지 이름 +
  선택적 `gate:goal`로 키를 잡는 오버라이드 맵)를 받습니다. 각 항목은 `vendor`, `candidates`,
  `sandbox`, `model`을 설정할 수 있어 "추론은 강한 모델, 실행은 이 호스트에서 실제로 쓸 수 있는
  쪽"이라는 하네스 계약을 그대로 표현합니다. `graph_next`가 준비된 노드마다 선택된 `model`을
  보고하고, 명시 `graph_run({model})`은 그 한 번의 호출에서 여전히 이깁니다.
- **v1.0.1 — 안정선. 기본 벤더 없음**: `vendor: "auto"`가 등록된 모든 벤더를 후보로 넣지 않습니다.
  후보 목록은 기본이 비어 있어, 이름을 대지 않은 런은 기존 경로대로 `self`로 내려갑니다.
- v1.0.0 — 임시 `broker` 플러그인 이름에서 그래프 엔지니어링 MCP를 빼내고 라이프사이클과 실행을
  분리했습니다: `graph:install`이 연결·검증을, `graph:orchestrate`가 그래프 구동을 맡습니다.

## 도구

| 도구 | 목적 |
|---|---|
| `graph_open` | 날 요청을 그대로 던지면, 브로커가 디스크 위에 노드 그래프로 흐름을 세웁니다 |
| `graph_next` | 어떤 노드가 준비됐고 각각 어떻게 라우팅됐는지 묻습니다 |
| `graph_run` | 라우팅된 벤더가 노드 하나를 실행합니다. **블로킹**이며 한 줄 판정을 돌려줍니다 |
| `graph_submit` | 오케스트레이터가 직접 실행한 노드를 기록합니다. 판정은 동일하게 받습니다 |
| `graph_retry` | 거절 피드백을 실어 새 시도를 엽니다 — 서브골 하나, 또는 스펙 자체. 예산 소진 시 실패를 확정하고 `unreachable[]`과 ready가 된 `report`를 돌려줍니다 |
| `graph_status` | 압축된 런 상태. `run_id`를 빼면 디렉터리의 모든 런과 지금 돌고 있는 것까지, `full:true`는 한 번에 노드 하나만 |

## 오케스트레이터는 페이로드를 들지 않는다

goal-spec, 서브골 수용 기준, 상류 핸드오프, 직전 거절 피드백, 변경 파일 목록, 증거는 전부 디스크의
그래프에 남습니다. 도구는 `{node_id, stage, vendor, state, stage_ok}`와 짧은 이유만 돌려줘요.
여기서 두 가지가 따라옵니다:

- **`setgoal`은 브로커 안에서 그래프를 확장합니다.** 거기서 만든 스펙은 호출자를 통과하지 않고,
  서브골별 implement/test/gate 노드와 그 의존성은 서버 쪽에서 파생됩니다.
- **모든 노드 프롬프트는 브로커가 그래프 상태로 조립합니다.** `graph_run`은 프롬프트를 받지
  않습니다 — 의도적으로 넘길 수 없습니다.

이게 긴 루프를 가능하게 하는 조건입니다. 노드 결과가 오케스트레이터 컨텍스트에 쌓이면, 재시도가
있는 그래프는 컨텍스트를 태우고 작업보다 루프가 먼저 죽습니다.

## 그래프

`plan -> setgoal -> critique`, 이후 서브골마다 `implement -> test -> gate`, 서브골 의존성은 gate
노드에 매핑, 마지막에 `gate:goal:1 -> report`.

간선은 두 종류입니다. `deps`는 **데이터 의존**: 노드가 dep의 산출물을 소비하므로 dep이 `done`이어야
합니다. `after`는 **순서만** 강제합니다 — Make의 `|` prerequisite: dep이 끝나기 전엔 시작하지 않되,
dep이 통과했을 필요는 없습니다. `report`는 goal gate에 `after`로 매달리고, 그래서 실패의 보고서를
쓸 수 있습니다. 스펙은 서브골에 `deps`와 나란히 `after: ["U1"]`을 줄 수 있습니다.

실패는 정확히 한 지점에서 **확정**됩니다: `graph_retry`가 재시도 예산 소진을 만났을 때. 그 전까지
`failed` 노드는 곧 있을 재시도이고, 하류의 어떤 것도 포기되지 않습니다. 확정되면 죽은 노드를 데이터
간선으로 필요로 하던 모든 노드가 이유와 함께 전이적으로 `unreachable`이 됩니다(`unreachable:
gate:U1:2 is unreachable`). 하류에서 이미 실패한 노드도 final이 되고, 순서 간선으로는 전파되지
않습니다. goal gate가 `unreachable`이 되고 `report`가 ready가 되어, 런은 무엇이 나갔고 무엇이 안
나갔는지 적은 리포트와 함께 `complete`로 끝납니다. report 노드가 아예 없는 런 — setgoal이 스펙을
끝내 못 만든 경우 — 만 여전히 `blocked`로 끝납니다.

거절된 서브골은 재실행 노드가 아니라 **새 시도**를 받습니다. 실패한 시도는 증거로 그래프에 남고,
아직 대기 중이던 노드는 `skipped`로 은퇴하며, 옛 gate를 기다리던 것들은 새 gate로 재배선됩니다.

**critique**가 스펙을 거절하면 서브골 하나를 다시 하는 건 아무것도 고치지 못합니다 — 분해 자체가
의심 대상이니까요. `subgoal_id` 없는 `graph_retry`는 critique가 지적한 문제를 피드백으로 실어
`setgoal`과 `critique`를 다시 열고, 거절된 스펙이 만든 서브골 그래프를 은퇴시킵니다. 재구성된
그래프는 살아있는 critique 노드에 매달립니다.

판정 노드는 `stage_ok: true`로도 실패할 수 있습니다. 거기서 `stage_ok`는 "판정 작업 자체가
돌아갔다"는 뜻이고, 판정 결과는 `accept` / `verified` / `sound`입니다. `stage_ok`만 읽은 탓에
거절된 서브골이 통과한 것처럼 하류로 흘러 게이트가 장식이 된 적이 있습니다. `graph_run`과
`graph_submit`은 의존성이 안 채워진 노드, 이미 끝난 노드, 존재하지 않는 노드를 거부합니다 —
순서는 권고가 아니라 강제입니다.

## 라우팅

`vendor: "auto"`(기본)는 후보를 순서대로 시도하고 `self`로 폴백합니다. 맨몸 직접 호출은 후보가
없습니다. `graph:orchestrate`는 대신
`vendor: "auto", allocation: "balanced", host_vendor, host_model, native_models`로 엽니다.
추론은 구동 AI/모델을 선호하고, Implement/Test는 반대 벤더의 Claude `sonnet` 또는 Codex
`gpt-5.6-sol`을 선호합니다. 한 벤더만 가용하면 fresh context와 선택 가능한 모델로 두 역할을 다
채울 수 있습니다. Fable/Astra는 구동 세션에서 자동 상속되지 않고 명시 모델 요청이 필요합니다.
호스트는 자기 네이티브 모델 능력을 정직하게 선언해야 합니다. Codex 세션은 중첩 Codex CLI 대신
네이티브 에이전트를 쓰고, 외부 벤더는 준비 프로브를 통과해야 합니다.

균형 랭킹은 스테이지 선호도, 배정/실행 중인 작업량, 완료 수, 실행 오류를 봅니다. 학습된 성능이나
비용 예측이 아니라 결정론적 휴리스틱입니다. 명시 정책이 이를 덮어씁니다. 토큰·비용 상한은
추가하지 않습니다. 리드는 범위가 잘린 산출물 경로를 넘기고 압축된 결과를 제출할 뿐, 모든 역할을
자기 대화 안에서 수행하지 않습니다. 한 태스크의 Implement/Test/Gate는 같은 작업 디렉터리와 코드
스냅샷을 공유합니다. 라우팅·산출물·재시도 계약과 브로커의 현재 강제 한계는
`skills/orchestrate/SKILL.md`를 보세요.

**이름을 지목한** 벤더는 폴백하지 않습니다 — 노드가 벤더별 프로브 이유와 함께
`vendor-failure`를 돌려줍니다. 누가 작업했는지 증명해야 하는 런이면 벤더를 지목하세요. 조용한
격하가 바로 그래프가 그 부분을 거짓말하게 만드는 경로입니다.

`vendor`, `model`, `candidates`, `sandbox`는 런 기본값을 정하고, `policy`가 **스테이지별로**
덮어씁니다. 키는 스테이지 이름(`plan`, `setgoal`, `critique`, `implement`, `test`, `gate`,
`report`)과 선택적 `gate:goal`입니다. 스테이지 항목이 런 설정을 이기고, 항목이 없는 스테이지는
상속하며, `graph_next`가 준비된 노드마다 선택된 `model`을 보고합니다. 선택된 모델은 준비
프로브에도 전달되므로 프로브와 실제 노드가 서로 다른 Codex 모델을 시험하는 사고가 없습니다.

추론 노드(plan, setgoal, critique, gate, report)는 읽기 전용 샌드박스로 라우팅됩니다. 내용으로
판정되니 대조할 파일 주장이 없습니다.

## 판정

브로커는 `stage_ok`를 **낮출** 수만 있고 올리지 못합니다. 주장된 `changed_files`는 `git status`와
대조됩니다:

- `isolated: true`(호출자가 사설 워크트리를 단언) -> `changed_files_verified`가 `true`/`false`.
- 공유 워크트리 -> 주장이 *반박*되지 않는 한 `null`. "귀속 불가"는 통과도 실패도 아닙니다.
- git 없음 -> `change_attribution: "no-git"`, 검증은 `null`.

워크트리에 나타나지 않는 주장 파일은 누가 보고했든(벤더든 오케스트레이터든) 노드를 실패시킵니다.

## 벤더

벤더는 어댑터 CLI 계약을 만족하는 무엇이든 됩니다:

```
<cmd> --detect  --cwd DIR --sandbox MODE --output FILE
<cmd> --stage implement|test --cwd DIR --prompt-file F --events-output F
      --output F --sandbox MODE [--isolated] [--add-dir DIR] [--model M]
```

실행 스테이지는 exit 0 **과** 리포트의 `stage_ok === true`를 함께 요구합니다. `codex`와 `claude`는
내장입니다(`adapters/codex-exec-adapter.mjs`, `adapters/claude-exec-adapter.mjs`). Claude는 resume
이나 세션 영속 없이 print 모드를 씁니다. 그래프로 재진입하지 않도록 MCP 상속을 끄고, 프로젝트
권한은 유지하며, 권한 검사를 우회하지 않습니다. 읽기 전용 프로필은 Read/Glob/Grep만 노출하고,
workspace-write는 기존 권한 범위에서 편집과 Bash 도구를 더합니다. 이건 OS 파일시스템 샌드박스가
아닙니다. 권한 거부된 작업은 눈에 보이게 실패합니다. CLI 플래그는
[Claude CLI 레퍼런스](https://code.claude.com/docs/en/cli-reference)를 따릅니다. 프로젝트별
추가는 `.claude/broker-vendors.json`에, 또는 `BROKER_VENDORS`로 레지스트리 파일을 가리키세요:

```json
{
  "myvendor": {
    "command": "node",
    "args": ["/abs/path/to/adapter.mjs"],
    "sandboxes": ["workspace-write"],
    "default_sandbox": "workspace-write",
    "requires_binary": "myvendor-cli"
  }
}
```

준비 확인은 버전 체크가 아니라 **실제 쓰기 프로브**입니다. 어떤 샌드박스는 시작하고, 런을
받아들이고, 아무것도 쓰지 않은 채 exit 0으로 끝나요. 프로브는 임시 파일을 만들고 파일시스템을
직접 확인합니다.

## 용량 복구

균형 런은 사용량 한도 오류를 작업 실패와 구분합니다 — 실행 시점과 준비 프로브 시점 모두에서요.
어댑터마다 그 메시지를 묻어두는 깊이가 달라서 프로브는 리포트 전체를 뒤집니다. 용량 소진으로
거절된 벤더는 "고장"이 아니라 "소진"으로 런에 기록됩니다. 쿼터 중단은 체크포인트, 원본
리포트/로그 경로, 작업 트리를 보존하고, 해당 런에서 그 벤더를 제외한 뒤 노드를 다른 가용 실행자가
집을 수 있게 준비 상태로 만듭니다. 다음 세션은 같은 목표 아래 체크포인트와 현재 파일을 확인하고
이어갑니다. 산출물에서 작업을 재개하는 것이고, 벤더 대화가 호환되는 게 아닙니다.

네이티브 에이전트라면 `stage_ok:false, failure_kind:"quota"`와 가진 증거를 제출하고 `graph_next`로
폴백을 받으세요. 모든 후보가 소진되면 런은 blocked로 보고합니다. 용량이 돌아온 뒤
`graph_retry({run_id,cwd,reset_capacity:true})`를 쓰고, 특정 중단 노드를 다시 열어야 하면
`node_id`를 더하세요. 외부 호출마다 자기 출력 디렉터리를 가집니다. 영속 상태는 MCP 재시작을
견디므로, 재연결할 때 `run_id`와 함께 원래 `cwd`를 주세요. 자동 워크트리 롤백은 없고, 부분 작업이
검증된 완료로 취급되는 일도 없습니다.

## 원장

각 노드의 `cwd` 아래:

- `.harness-run/broker/ledger.jsonl` — append-only 히스토리
- `.harness-run/broker/open-nodes.json` — PreToolUse 훅이 읽을 수 있는 스냅샷

하네스 게이트는 윈도 안에 열린 노드가 있으면 engagement로 봅니다. 원장은 증거이지 의존성이
아닙니다 — 쓰기 실패가 노드를 실패시키는 일은 없고, 원장이 없거나 낡거나 깨졌으면 그냥
engagement가 아닌 것으로 처리됩니다.

## 스킬

- `install` — 기존 그래프 엔진을 복사하지 않고 연결하거나 검증합니다
- `orchestrate` — 메인 세션에서 하네스 흐름 전체를 구동합니다
