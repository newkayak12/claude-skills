# skill

**English** · [한국어](#한국어)

Two skills that inspect other skills. A SKILL.md can fail in two independent ways: it never fires
because its `description` gives Claude no signal, or it fires and then doesn't earn its place —
too heavy, badly structured, or no better than no skill at all. `skill-trigger-validator` measures
and fixes the first; `skill-quality-assurance` runs the six checks that cover the second, ending
in a prioritized fix list.

## Install & Uninstall

```bash
/plugin install skill@newkayak12-claude-skills
/plugin uninstall skill@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Review a skill before shipping and get a ranked list of what to fix | `skill-quality-assurance` |
| Fix a skill that doesn't fire on natural language, especially Korean | `skill-trigger-validator` |

## Skills

### `skill-quality-assurance`

Runs six quality checks on a skill and produces an actionable report. It reads every file in the
skill directory — `SKILL.md`, `agents/`, `references/`, `scripts/` — noting absent directories
rather than skipping the check, then dispatches checks 1–5 in parallel and check 6 after, since
output quality depends on knowing what the skill promised. It is the gate before publishing and
also useful mid-creation.

```
Review skill/skills/skill-trigger-validator before I ship it. Six checks, and tell me
what to fix first.
```

| # | Check | Agent | Verdict scale |
|---|---|---|---|
| 1 | Usefulness | `agents/usefulness-checker.md` | PASS / WARN / FAIL |
| 2 | Authoring principles | `agents/authoring-checker.md` | PASS / WARN / FAIL |
| 3 | Agent structure | `agents/structure-reviewer.md` | GOOD / IMPROVABLE / MISSING |
| 4 | MCP fit | `agents/mcp-advisor.md` | NONE / OPTIONAL / RECOMMENDED |
| 5 | SKILL.md weight | `agents/weight-analyzer.md` | LIGHT / OK / HEAVY / CRITICAL |
| 6 | Output quality | `agents/eval-agent.md` | PASS / MARGINAL / FAIL |

Check 6 measures with-skill against a no-skill baseline and reports both pass rates plus the
delta, the discriminating assertions the skill enforces, and the gaps it promises but doesn't
deliver. The report closes with **Top Improvements** — 🔴 must fix / 🟡 recommended / 🟢 optional —
written concretely enough to act on directly.

### `skill-trigger-validator`

Audits the `description` field, the only signal Claude uses when deciding whether to invoke a
skill, and rewrites it as a drop-in replacement. Point it at a single skill, a whole plugin, or
the entire repo; if no target is given it asks first. It touches only the frontmatter
`description`, never the body, and asks before applying anything.

```
develop 플러그인 스킬들 트리거 커버리지 감사해줘. 한국어로 말할 때 안 걸리는 것부터.
```

Per skill it generates 10 test queries — 2 formal English, 2 natural English, 3 natural Korean,
2 borderline that should *not* trigger, 1 implicit need — scores each against the current
description, and reports `(correct / 10) × 10`. Named failure patterns: Korean blind spot,
keyword-only, jargon wall, too narrow, too broad. The rewrite follows a fixed shape:

```
[What skill does]. Use when [situation/intent] — [English phrases], or Korean:
[한국어 구어체]. Also triggers on [implicit/borderline cases worth catching].
```

Batch runs lead with a summary table and give full reports only for skills scoring below 7; 7+ is
"acceptable — no action needed". If you accept the rewrites, it applies them and then follows
`INSTRUCT.md` — bump the patch version in `marketplace.json`, update the plugin README, commit,
push.

## Related plugins

- `write:writing-skills` — the authoring guide these two check the output of.

---

# 한국어

[English](#skill) · **한국어**

다른 스킬을 검사하는 스킬 둘입니다. SKILL.md는 독립적인 두 가지 방식으로 실패합니다 —
`description`이 신호를 못 줘서 아예 안 걸리거나, 걸리긴 하는데 제값을 못 하거나(너무 무겁거나,
구조가 나쁘거나, 스킬 없을 때와 차이가 없거나). `skill-trigger-validator`가 첫 번째를 재고
고치고, `skill-quality-assurance`가 두 번째를 6개 검사로 훑고 우선순위 붙은 수정 목록으로 끝냅니다.

## 설치 / 제거

```bash
/plugin install skill@newkayak12-claude-skills
/plugin uninstall skill@newkayak12-claude-skills
```

## 어떤 스킬을 쓰나

| 하고 싶은 것 | 스킬 |
|---|---|
| 배포 전 스킬 검토하고 뭘 먼저 고칠지 순위 받기 | `skill-quality-assurance` |
| 자연어(특히 한국어)에 안 걸리는 스킬 고치기 | `skill-trigger-validator` |

## 스킬

### `skill-quality-assurance`

스킬 하나에 6개 품질 검사를 돌리고 바로 행동 가능한 리포트를 냅니다. 스킬 디렉터리의 모든 파일을
먼저 읽고 — `SKILL.md`, `agents/`, `references/`, `scripts/` — 없는 디렉터리는 검사를 건너뛰는
대신 "없음"으로 기록합니다. 1–5번은 병렬로, 6번은 그다음에 돕니다(출력 품질은 스킬이 무엇을
약속했는지 알아야 잴 수 있으니까). 배포 전 게이트이자 제작 중간 점검용입니다.

```
skill/skills/skill-trigger-validator 배포 전에 검토해줘. 6개 검사 다 돌리고
뭐부터 고쳐야 하는지 알려줘.
```

| # | 검사 | 에이전트 | 판정 |
|---|---|---|---|
| 1 | 유용성 | `agents/usefulness-checker.md` | PASS / WARN / FAIL |
| 2 | 저작 원칙 | `agents/authoring-checker.md` | PASS / WARN / FAIL |
| 3 | 에이전트 구조 | `agents/structure-reviewer.md` | GOOD / IMPROVABLE / MISSING |
| 4 | MCP 적합성 | `agents/mcp-advisor.md` | NONE / OPTIONAL / RECOMMENDED |
| 5 | SKILL.md 무게 | `agents/weight-analyzer.md` | LIGHT / OK / HEAVY / CRITICAL |
| 6 | 출력 품질 | `agents/eval-agent.md` | PASS / MARGINAL / FAIL |

6번은 스킬 적용/미적용 baseline을 비교해 양쪽 통과율과 델타, 스킬이 실제로 강제하는 변별
assertion, 약속했지만 지키지 못한 갭을 보고합니다. 리포트는 **Top Improvements** — 🔴 필수 /
🟡 권장 / 🟢 선택 — 로 닫히고, "구조 개선" 같은 말이 아니라 바로 손댈 수 있는 문장으로 씁니다.

### `skill-trigger-validator`

Claude가 스킬 호출 여부를 판단할 때 쓰는 유일한 신호인 `description` 필드를 감사하고, 그대로
갈아끼울 수 있는 새 description을 써줍니다. 대상은 스킬 하나, 플러그인 전체, 레포 전체 중 하나
— 안 주면 먼저 물어봅니다. 프론트매터의 `description`만 고치고 본문은 건드리지 않으며, 적용
전에 반드시 물어봅니다.

```
develop 플러그인 스킬들 트리거 커버리지 감사해줘. 한국어로 말할 때 안 걸리는 것부터.
```

스킬마다 테스트 쿼리 10개를 만듭니다 — 격식 영어 2, 자연스러운 영어 2, 자연스러운 한국어 3,
트리거되면 *안 되는* 인접 주제 2, 스킬 이름을 말하지 않는 암묵적 요구 1 — 현재 description으로
각각 채점해 `(맞은 수 / 10) × 10`을 냅니다. 지목하는 실패 패턴: 한국어 사각지대, 키워드만 나열,
전문용어 벽, 너무 좁음, 너무 넓음. 재작성 형식:

```
[스킬이 하는 일]. Use when [상황/의도] — [영어 표현들], or Korean:
[한국어 구어체]. Also triggers on [잡을 가치 있는 암묵적·경계 사례].
```

일괄 실행은 요약 테이블로 시작하고 7점 미만인 스킬만 개별 리포트를 냅니다. 7점 이상은
"acceptable — no action needed". 재작성을 수락하면 적용한 뒤 `INSTRUCT.md`를 따릅니다 —
`marketplace.json` 패치 버전 올리고, 플러그인 README 갱신하고, 커밋, 푸시.

## 관련 플러그인

- `write:writing-skills` — 이 둘이 검사하는 결과물을 만드는 저작 가이드.
