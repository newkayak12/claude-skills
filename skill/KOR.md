# skill — 한국어

[English](README.md) · **한국어**

스킬을 만들고 검사하는 스킬 넷입니다. `create`가 레포 고유의 성격을 지닌 새
스킬을 써줍니다. 그렇게 만든 SKILL.md도 독립적인 두 가지 방식으로 실패합니다 —
`description`이 신호를 못 줘서 아예 안 걸리거나, 걸리긴 하는데 제값을 못 하거나(너무 무겁거나,
구조가 나쁘거나, 스킬 없을 때와 차이가 없거나). `trigger-validator`가 첫 번째를 재고
고치고, `quality-assurance`가 두 번째를 6개 검사로 훑고 우선순위 붙은 수정 목록으로 끝냅니다. `audit`은 이 셋보다 먼저 옵니다. 새로 설치하거나
만들기 전에 워크스페이스에 이미 무엇이 있는지 확인합니다.

## 설치 / 제거

```bash
/plugin install skill@newkayak12-claude-skills
/plugin uninstall skill@newkayak12-claude-skills
```

## 어떤 스킬을 쓰나

| 하고 싶은 것 | 스킬 |
|---|---|
| "X용 스킬이 필요해"를 레포 스킬들과 같은 결의 SKILL.md로 만들기 | `create` |
| 배포 전 스킬 검토하고 뭘 먼저 고칠지 순위 받기 | `quality-assurance` |
| 자연어(특히 한국어)에 안 걸리는 스킬 고치기 | `trigger-validator` |
| 설치·제작 전에 이 워크스페이스에 뭐가 있고 뭐가 빠졌는지 보기 | `audit` |
| 세션에서 반복된 실수를 규칙이 아니라 검사로 막기 | `retro` |

## 스킬

### `create`

레포 주인이 쓴 것처럼 읽히는 새 스킬을 씁니다. 모양은 가장 덜 중요합니다. `create`는
`references/identity.md` — 스킬 ~30개와 주인의 코딩 가이드라인에서 귀납한 13개 원칙(다시 셀 수 있는
출력, 빠진 사실을 지어내지 않기, 행위자는 자기 채점 금지, 편한 반사 행동 하나 금지, 경계 명시, 결정은
사용자, 최소·국소 변경) — 를 기준으로 씁니다. 초안 전에 identity.md와 실제 스킬 3–4개를 읽고, 이 스킬이
막을 반사 행동, `Not for` 경계, "끝"의 기준을 세 줄로 먼저 적습니다. 초안을 13개 원칙에 대조하고, 레포
validator를 돌린 뒤 `trigger-validator`, 이어서 `quality-assurance`로 넘깁니다. 수정·보수는 계속
`write:writing-skills`가 맡습니다.

```
커밋 메시지가 우리 컨벤션을 따르는지 검사하는 스킬 만들어줘. 이 레포의 다른 스킬들이
어떻게 생겼는지 먼저 봐.
```

### `quality-assurance`

스킬 하나에 6개 품질 검사를 돌리고 바로 행동 가능한 리포트를 냅니다. 스킬 디렉터리의 모든 파일을
먼저 읽고 — `SKILL.md`, `agents/`, `references/`, `scripts/` — 없는 디렉터리는 검사를 건너뛰는
대신 "없음"으로 기록합니다. 1–5번은 병렬로, 6번은 그다음에 돕니다(출력 품질은 스킬이 무엇을
약속했는지 알아야 잴 수 있으니까). 배포 전 게이트이자 제작 중간 점검용입니다.

```
skill/skills/trigger-validator 배포 전에 검토해줘. 6개 검사 다 돌리고
뭐부터 고쳐야 하는지 알려줘.
```

| # | 검사 | 에이전트 | 판정 |
|---|---|---|---|
| 1 | 유용성 | `agents/usefulness-checker.md` | PASS / WARN / FAIL |
| 2 | 저작 원칙 (필수 섹션·길이, 단계별 완료 기준 포함) | `agents/authoring-checker.md` | PASS / WARN / FAIL |
| 3 | 에이전트 구조 | `agents/structure-reviewer.md` | GOOD / IMPROVABLE / MISSING |
| 4 | MCP 적합성 | `agents/mcp-advisor.md` | NONE / OPTIONAL / RECOMMENDED |
| 5 | SKILL.md 무게 | `agents/weight-analyzer.md` | LIGHT / OK / HEAVY / CRITICAL |
| 6 | 출력 품질 | `agents/eval-agent.md` | PASS / MARGINAL / FAIL |

6번은 스킬 적용/미적용 baseline을 비교해 양쪽 통과율과 델타, 스킬이 실제로 강제하는 변별
assertion, 약속했지만 지키지 못한 갭을 보고합니다. 리포트는 **Top Improvements** — 🔴 필수 /
🟡 권장 / 🟢 선택 — 로 닫히고, "구조 개선" 같은 말이 아니라 바로 손댈 수 있는 문장으로 씁니다.

### `trigger-validator`

Claude가 스킬 호출 여부를 판단할 때 쓰는 유일한 신호인 `description` 필드를 감사하고, 그대로
갈아끼울 수 있는 새 description을 써줍니다. 대상은 스킬 하나, 플러그인 전체, 레포 전체 중 하나
— 안 주면 먼저 물어봅니다. 프론트매터의 `description`만 고치고 본문은 건드리지 않으며, 적용
전에 물어봅니다 (이미 고쳐 달라고 했다면 바로 적용).

```
develop 플러그인 스킬들 트리거 커버리지 감사해줘. 한국어로 말할 때 안 걸리는 것부터.
```

스킬마다 구체적인 테스트 쿼리 20개를 만듭니다 — 트리거돼야 하는 10개(격식·자연스러운 영어,
자연스러운 한국어, 암묵적 요구, 형제 스킬과 경쟁해서 이겨야 하는 경우 하나)와, 키워드는 겹치지만
다른 것이 필요한 아슬아슬한 오답 10개. 현재 description으로 각각 채점해 `(맞은 수 / 20) × 10`을
냅니다. 기본은 판단 점수이고, 요청하면 headless `claude -p`로 쿼리마다 3번 돌려 측정합니다(3번 중
2번 이상 발동하면 적중). 측정 모드 재작성은 12개로 최대 세 번 다듬고, 남겨 둔 8개에서 가장 잘 나온
description을 고릅니다. 지목하는 실패 패턴: 한국어 사각지대, 키워드만 나열,
전문용어 벽, 너무 좁음, 너무 넓음. 재작성은 `Use when`으로 시작하고 250자 안에 들며, 형식은:

```
Use when [상황/의도]. Triggers on: "[한국어 구어체]", "[English phrase]", "[암묵적 사례]".
```

일괄 실행은 요약 테이블로 시작하고 7점 미만인 스킬만 개별 리포트를 냅니다. 7점 이상은
"acceptable — no action needed". 적용한 뒤 레포의 업데이트 절차를 따릅니다 —
`marketplace.json` 버전 올리고, 플러그인 `README.md`와 `KOR.md`를 함께 갱신하고, 커밋.

### `audit`

"여기 뭐가 빠졌지?"에 기억이 아니라 파일로 답합니다. 워크스페이스를 이름만으로 훑습니다 —
`.claude/settings*`, `.mcp.json`, 훅, `CLAUDE.md`, 설치된 플러그인, 이번 세션의 스킬 목록, `.env*`의
키 이름(값은 절대 안 봄). 그다음 이 설치본이 볼 수 있는 카탈로그, 즉 세션 스킬 목록과
`~/.claude/plugins` 아래 마켓플레이스 매니페스트·README에 빈틈을 맞춰 봅니다. 거기 없을 때만
`_reference/external-skills.md`를 보고, 거기서 찾은 것은 *candidate, unverified*로 표시합니다. 표의 모든
행에 출처 경로가 붙고, 경로가 없으면 행을 빼거나 `no match`로 적습니다. 읽기 전용입니다. 스킬 모양의
빈틈은 `create`로, 훅·권한은 `update-config`로 넘깁니다. 하네스 설치(`harness:install`)용이 아닙니다.

```
뭘 더 설치하면 좋아? 지금 이 레포에 뭐가 깔려 있는지부터 봐줘.
```

### `retro`

세션에서 반복된 실수를 검사로 바꿉니다. 사용자가 고쳐 준 말을 인용하고 반복 횟수를 세며, 제안하기 전에 저장소의
검사 명령(package.json scripts, hook, CI)부터 읽습니다. lint 규칙이나 hook, 테스트로 잡을 수 있는 기계적 반복은
그 검사를 해법으로 삼고, 판단이 필요한 것만 이유(scar)를 붙여 CLAUDE.md 한 줄로 남깁니다. 승인한 행만 반영하고
그 전에는 아무것도 쓰지 않습니다. 어떤 스킬이 있는지 보는 건 `audit`, 스킬 하나를 고치는 건
`write:writing-skills`입니다.

```
이번 세션 회고해서 다음에 같은 실수 안 하게 해줘
```

에이전트가 alias 없는 `@/` import를 두 번 쓰고 lint 없이 완료를 두 번 보고한 세션으로 비교했을 때, 스킬 없이는
메모만 남기고 lint 규칙은 "원하시면" 정도로만 제안했습니다. 스킬을 쓰면 두 반복 모두 검사가 됐습니다. ESLint
`no-restricted-imports` 규칙과 lint를 돌리는 Stop hook이었고, 승인 전에 쓴 파일은 0개였습니다.

## 이름 변경

`skill-quality-assurance`는 `quality-assurance`로, `skill-trigger-validator`는 `trigger-validator`로 바뀌었습니다. 기존 `skill:skill-quality-assurance` / `skill:skill-trigger-validator` 호출은 더 이상 동작하지 않으니 `skill:quality-assurance` / `skill:trigger-validator`를 쓰세요.

## 관련 플러그인

- `write:writing-skills` — 이 둘이 검사하는 결과물을 만드는 저작 가이드.
