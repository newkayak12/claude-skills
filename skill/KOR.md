# skill — 한국어

[English](README.md) · **한국어**

다른 스킬을 만들고 검사하는 스킬 셋입니다. `create`가 레포 고유의 성격을 지닌 새
스킬을 써줍니다. 그렇게 만든 SKILL.md도 독립적인 두 가지 방식으로 실패합니다 —
`description`이 신호를 못 줘서 아예 안 걸리거나, 걸리긴 하는데 제값을 못 하거나(너무 무겁거나,
구조가 나쁘거나, 스킬 없을 때와 차이가 없거나). `trigger-validator`가 첫 번째를 재고
고치고, `quality-assurance`가 두 번째를 6개 검사로 훑고 우선순위 붙은 수정 목록으로 끝냅니다.

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
| 2 | 저작 원칙 (필수 섹션·길이 포함) | `agents/authoring-checker.md` | PASS / WARN / FAIL |
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

스킬마다 테스트 쿼리 10개를 만듭니다 — 격식 영어 2, 자연스러운 영어 2, 자연스러운 한국어 3,
트리거되면 *안 되는* 인접 주제 2, 스킬 이름을 말하지 않는 암묵적 요구 1 — 현재 description으로
각각 채점해 `(맞은 수 / 10) × 10`을 냅니다 — 기본은 판단 점수, 요청하면 headless
`claude -p`로 쿼리를 실제로 돌려 측정합니다. 지목하는 실패 패턴: 한국어 사각지대, 키워드만 나열,
전문용어 벽, 너무 좁음, 너무 넓음. 재작성은 `Use when`으로 시작하고 250자 안에 들며, 형식은:

```
Use when [상황/의도]. Triggers on: "[한국어 구어체]", "[English phrase]", "[암묵적 사례]".
```

일괄 실행은 요약 테이블로 시작하고 7점 미만인 스킬만 개별 리포트를 냅니다. 7점 이상은
"acceptable — no action needed". 적용한 뒤 레포의 업데이트 절차를 따릅니다 —
`marketplace.json` 버전 올리고, 플러그인 `README.md`와 `KOR.md`를 함께 갱신하고, 커밋.

## 이름 변경

`skill-quality-assurance`는 `quality-assurance`로, `skill-trigger-validator`는 `trigger-validator`로 바뀌었습니다. 기존 `skill:skill-quality-assurance` / `skill:skill-trigger-validator` 호출은 더 이상 동작하지 않으니 `skill:quality-assurance` / `skill:trigger-validator`를 쓰세요.

## 관련 플러그인

- `write:writing-skills` — 이 둘이 검사하는 결과물을 만드는 저작 가이드.
