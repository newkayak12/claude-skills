# graph-beta (team) v0.10.1 — planning/qa kind + 페르소나·mounts + entry 스킬 2개 구현 계획

> Produced by write:writing-plans. Owner for execution routing: planning:executing-plans.
> Steps use checkbox (`- [ ]`) syntax. 설계 근거: `2026-09-17-graph-beta-team.md` §3·§11.

**Goal:** `graph.mjs`의 `KINDS`에 `planning`(draft→revise→gate)과 `qa`(cases→execute→gate) 두 kind를
추가하고, §3이 정한 페르소나·단계 스킬·MCP mounts를 채우고, 그 둘을 직접 돌릴 수 있는 entry 스킬
`graph-beta:plan`/`graph-beta:qa`를 신설한다. EPIC 흐름(§2)에 planning을 shape 앞에, qa를 integrate
뒤에 끼워 넣는 배선과 ticket/board 레이어는 이 라운드에 없다 — 그건 v0.11.0 이후의 `docs.mjs`/`tickets.mjs`
위에서 일어나고, 여기서는 kind 자체가 독립적으로(오늘의 `develop`/`document`처럼 `tm_open({flow})`로
직접) 돌아가는 것까지만 만든다.

**Architecture:** 엔진(`graph.mjs`의 `pushChain`/`expandSubgoals`/`retrySubgoal`/`settleFailure`)은
`kind`가 무엇이든 `KINDS[kind].chain`만 읽어 체인을 펼치므로 로직 변경이 없다는 설계 문서 §3의 전제는
조사로 확인했다 — 맞다. 하지만 그 전제가 미치지 않는 지점이 셋 있었고, 이번 계획은 그 셋을 모두 채운다:
`prompts.mjs`의 `CONTRACT` 테이블(스테이지별 "Required output" 지시문 — 없으면 `composePrompt`가
`CONTRACT.implement`로 조용히 폴백한다), `graph.mjs`의 `VERDICT_FIELD`(스테이지별 판정 필드 — 없으면
그 스테이지는 거부돼도 재배정되지 않는다), 그리고 `broker.mjs`의 `reviewIndependence`(review에만
하드코딩된 "저자와 다른 정체성" 강제 — revise도 같은 요구가 있다는 게 §3의 결정이라 넓혔다).

**Tech Stack:** Node 18+ ESM, `node:test`, 런타임 의존성 0. 테스트는 `node --test graph-beta/scripts/test-*.mjs`.

**이번 라운드에 들어가는 것 (§11):** `KINDS.planning`/`KINDS.qa`, 페르소나(`FLOWS.plan`/`FLOWS.qa`),
단계 스킬(`KINDS[kind].skills`), MCP mounts(`GRAPH_STAGE_MOUNTS`), entry 스킬 2개
(`graph-beta:plan`, `graph-beta:qa`), 단위/통합 테스트, bench 요청 파일 2개(`plan-flat`/`qa-flat`).

**범위 밖과 그 이유:**
- **EPIC 흐름 배선(§2) — planning이 shape 앞, qa가 integrate 뒤, 결함 STORY(§5b), `planning-audit`
  kind, `team.json.roles`를 실제로 켜는 것.** 전부 TaskManager/ticket 레이어 위에서 일어나고
  그 레이어(`tickets.mjs`, `board.jsonl`, `docs.mjs`)는 v0.11.0이다. `team.json`의 `roles` 키는
  이미 v0.10.0에서 기록만 되게 스캐폴딩되어 있고(`teamconfig.mjs`의 `TEAM_DEFAULTS.roles`), 이번
  라운드도 그 값을 읽어 분기하는 코드를 추가하지 않는다 — 채우는 건 kind 자체와 그걸 직접 돌리는
  entry 스킬뿐이다.
- **`planning-audit` kind.** §3 표에 있지만 §11 v0.10.1 행에는 없다 — EPIC 흐름의 두 번째 planning
  패스(크로스 검수)라서 같은 이유로 v0.11.0+.
- **PRD가 실제로 `.harness-run/team/E-<task8>/10-prd.md`에 자동으로 쓰이는 것.** 그 경로 자체는
  Task 5·7에서 문서화하고 한 번 테스트로 왕복시키지만, "이 EPIC의 이 경로"를 자동으로 계산해 주는
  코드(`docs.mjs`)는 없다 — 오늘도 setgoal이 짓는 스펙의 `subgoal.files[]`에 그 경로를 직접 이름
  붙이면 그대로 동작하는 일반 메커니즘이고, v0.10.1은 그 사실을 검증하고 entry 스킬에 적을 뿐이다.

**전제 사실 (조사로 확인):**
- `graph-beta/mcp/graph.mjs`의 `KINDS`는 오늘 `subgoal`(implement→test→gate)과
  `document`(draft→review→gate) 둘뿐이고, `reasoning`/`skills`는 kind별로 체인의 부분집합을 선언한다.
  체인을 펼치는 `pushChain`/`expandSubgoals`/`retrySubgoal`/`gateStage`/`authorStage`는 모두
  `KINDS[kind].chain`만 읽는 제네릭 함수 — 새 kind 추가에 엔진 로직 변경이 없다는 설계 문서의 전제는 맞다.
- `STAGES`(graph.mjs 17-26행)는 사람이 읽는 참조 목록일 뿐 어디서도 값으로 소비되지 않는다(자기 자신의
  선언과 한 줄의 주석 참조가 전부). 새 스테이지 이름(`revise`/`cases`/`execute`)을 추가하지 않아도
  기능에 영향이 없어 이번 계획은 건드리지 않는다.
- `graph-beta/mcp/mounts.mjs`(설계 문서가 "broker.mjs"라 부른 것과 달리 실제로는 별도 파일이다 —
  아래 발견 5)의 `GRAPH_STAGE_SKILLS`/`GRAPH_STAGE_MOUNTS`는 **kind가 아니라 스테이지 이름**으로 키가
  잡힌다. `gate`처럼 모든 kind가 공유하는 이름도 있고 `test`/`review`처럼 오늘은 kind 하나만 쓰지만
  이름 자체는 전역인 것도 있다 — `draft`도 그런 이름이라, planning에 mount를 추가하면 document의
  draft에도 그대로 적용된다(부작용, 아래 발견 3).
- `prompts.mjs`의 `CONTRACT`는 스테이지 이름으로 룩업하고 없으면 `CONTRACT.implement`로 폴백한다
  (`composePrompt` 끝부분). `revise`/`cases`/`execute`는 오늘 이 테이블에 없다 — 실사용자 벤더에게
  틀린 출력 형식을 조용히 지시하게 된다는 뜻이라, 이번 계획에서 채운다(발견 4).
- `graph.mjs`의 `VERDICT_FIELD = { gate, critique, test, review }`도 스테이지 이름으로 키가 잡히고,
  `broker.mjs`의 `nodeSucceeded`/거부 시 재배정 로직(`retrySubgoal` 호출부)은 전부 이 테이블을
  제네릭하게 읽는다(하드코딩 없음, 조사로 확인) — `execute`를 추가하면 qa의 execute가 test/review와
  똑같이 거부→재배정된다(발견 4b).
- `broker.mjs`의 `reviewIndependence(run, n, executor, model)`는 `n.stage !== 'review'`면 즉시
  `null`을 반환한다 — "저자와 다른 정체성이 검토한다"는 강제가 review 스테이지 이름에 하드코딩돼
  있다는 뜻. §3은 revise에도 같은 요구("다른 정체성이 퇴고")를 적어 뒀으므로 이 가드를 넓힌다(발견 6).
  단, `reviewer_independence` 필드를 결과에 병합하는 코드는 reasoning 분기에만 있고 revise는
  reasoning이 아니므로(발견 1) 거부(예외)는 revise에도 적용되지만 결과 payload에 provenance 필드가
  나타나지는 않는다 — 그 병합 확장은 이번 라운드 밖으로 남겨 뒀다(Task 7에서 다시 설명).
- `pm` 플러그인에는 `prd-development` 스킬이 있고 그 `template.md`는 10절 스켈레톤(Executive
  Summary … Open Questions)이다. §3이 함께 적은 `pm:user-story`라는 이름의 스킬은 존재하지 않는다
  (`pm/skills/`에는 `user-story-splitting`/`user-story-mapping`/`user-story-mapping-workshop`만
  있다) — 팀 리더의 지시(사용자 스토리 템플릿으로 대체 금지)와 일치하므로 draft 스킬 목록에서
  이 항목은 그냥 뺐다.
- `graph-beta/skills/{develop,document}/SKILL.md`가 entry 스킬의 유일한 선례다. 둘 다 `tm_open({flow})`을
  고정하고 `../orchestrate/{SKILL.md,references/loop.md}`를 그대로 따르는 얇은 래퍼 — 새 entry 스킬
  둘도 같은 모양이다.
- `graph-beta/scripts/bench/requests/`의 `*-flat.txt`는 평문 한 단락 요청서다. `tinyq`
  픽스처(`fixtures/tinyq/src/{index,queue,retry,worker}.mjs` + `test/*.test.mjs`)는 실제 코드와
  테스트가 이미 있는 유일한 flat 픽스처라서(`ledger`/`seam`은 빈 패키지) plan-flat과 qa-flat 둘 다
  이걸 쓴다 — 새 픽스처는 만들지 않는다.
- `scripts/validate_plugins.py`는 스킬을 디렉터리 존재만으로 발견한다(매니페스트에 이름을 등록하는
  절차 없음) — `graph-beta/skills/plan/SKILL.md`, `graph-beta/skills/qa/SKILL.md`를 만드는 것 자체가
  등록이다.
- **팀 리더 지시**: 이 파일 하나만 내가 소유한다. `docs/plans/2026-09-17-graph-beta-team.md`는 다른
  agent가 병행 편집 중이라 이 계획은 그 파일을 건드리지 않는다 — v0.10.0의 Task 9가 했던 "설계 문서
  §11/§13 갱신"에 해당하는 부분이 이번 계획에는 없다(Task 8 참고).

**§3/§11 대비 발견한 불일치 (팀 리더에게 보고):**
1. §3 표는 `revise`를 "reasoning 단계" 칸에 적어 두고 같은 행의 설명에서는 "review(판정)와 다르게
   수정 권한 있음"이라 적었다 — 자기모순이다. `REASONING_STAGES`는 파일을 바꾸지 않는 스테이지의
   집합이고(그런 스테이지는 프롬프트에 "Do not modify project files"가 박힌다), 수정 권한이 있다는
   서술과 정면으로 충돌한다. `document` kind의 선례(draft는 mutate라 reasoning이 아니고, review만
   reasoning)를 따라 `KINDS.planning.reasoning = []`로 정정했다 — revise는 draft처럼 mutate하는
   저작 스테이지이고, 판정은 여전히 마지막 `gate`뿐이다.
2. §3의 draft 스킬 목록에 있는 `pm:user-story`는 실재하지 않는 스킬 이름이다(위 전제 사실 참고).
   대체하지 말라는 지시와 맞아떨어지므로 그냥 뺐다 — `pm:prd-development` + `write:doc-coauthoring`만 쓴다.
3. §3의 "단계 MCP mounts" 표는 역할(kind)별로 적혀 있지만 실제 메커니즘(`GRAPH_STAGE_MOUNTS`)은
   스테이지 **이름**으로만 키가 잡힌다. `cases`는 qa 전용 이름이라 안전하게 추가되지만, `draft`는
   `document` kind도 이미 쓰는 이름이라 `draft: think-tool` mount는 document의 draft에도 조용히
   적용된다. mount는 advisory이고(연결 안 돼 있으면 조용히 무시) 무해하다고 보고 그대로 추가했지만,
   §3의 "역할별" 프레이밍이 메커니즘과 어긋난다는 점은 기록해 둔다.
4. §3/§11 어디에도 `prompts.mjs`의 `CONTRACT` 테이블이나 `graph.mjs`의 `VERDICT_FIELD` 테이블은
   언급이 없다. 둘 다 새 스테이지 이름(`revise`/`cases`/`execute`)에 항목이 없으면 조용히 잘못
   동작한다(각각 CONTRACT.implement 폴백, 거부해도 재배정 안 됨) — 원래 지시받은 파일 목록(graph.mjs,
   mounts.mjs)에 없던 `prompts.mjs` 변경이 이번 계획에 들어간 이유다.
5. 팀 리더의 지시는 `GRAPH_STAGE_SKILLS`/`GRAPH_STAGE_MOUNTS`를 "broker.mjs"에서 찾으라고 했지만
   실제로는 `graph-beta/mcp/mounts.mjs`에 있다(broker.mjs는 그 값을 가져다 쓰지 않고,
   `composePrompt`가 `mounts.mjs`를 직접 import한다). 파일 자체는 정확히 찾아 반영했다.
6. §3의 "revise는 다른 정체성이 퇴고"는 오늘 코드에서 강제되지 않는다 — `reviewIndependence`가
   `n.stage !== 'review'`로 하드코딩돼 있다. Task 7에서 넓혔다(위 전제 사실 참고). 이건 팀 리더가
   준 파일 목록에 없던 `broker.mjs` 변경이 필요했던 이유다.

---

### Task 1: `graph.mjs` — `KINDS.planning`/`KINDS.qa`, `VERDICT_FIELD.execute`, `FLOWS.plan`/`FLOWS.qa`
**Files:** modify `graph-beta/mcp/graph.mjs`, create `graph-beta/scripts/test-graph.mjs`
**Interfaces:** produces `KINDS.planning`, `KINDS.qa`, `VERDICT_FIELD.execute`, `FLOWS.plan`,
`FLOWS.qa` — Task 2(prompts.mjs)·Task 3(mounts.mjs)·Task 7(broker.mjs 통합 테스트)이 소비.
**Pass bar:** `node --test graph-beta/scripts/test-graph.mjs` 6개 통과.

- [ ] 1: 실패하는 테스트를 쓴다
```js
// graph-beta/scripts/test-graph.mjs - unit tests for graph.mjs's kind/flow tables: the shape
// the engine reads to expand a chain, key it to a verdict field, and pick default personas.
// Full round-trip behaviour (a real run expanding and judging a planning/qa subgoal) lives in
// test-broker.mjs alongside the document-kind suite this mirrors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, VERDICT_FIELD, REASONING_STAGES, FLOWS, kindSkills, kindOf, authorStage } from '../mcp/graph.mjs';

test('planning kind: chain, no reasoning stage, and skills by stage', () => {
  assert.deepEqual(KINDS.planning.chain, ['draft', 'revise', 'gate']);
  assert.deepEqual(KINDS.planning.reasoning, []);
  assert.deepEqual(kindSkills('planning', 'draft'), ['pm:prd-development', 'write:doc-coauthoring']);
  assert.deepEqual(kindSkills('planning', 'revise'), ['write:writer-verification', 'think:devils-advocate']);
  assert.deepEqual(kindSkills('planning', 'gate'), ['think:devils-advocate']);
  assert.equal(authorStage('planning'), 'draft');
});

test('qa kind: chain, no reasoning stage, and skills by stage', () => {
  assert.deepEqual(KINDS.qa.chain, ['cases', 'execute', 'gate']);
  assert.deepEqual(KINDS.qa.reasoning, []);
  assert.deepEqual(kindSkills('qa', 'cases'), ['develop:test-master', 'develop:scenario-director']);
  assert.deepEqual(kindSkills('qa', 'execute'), ['develop:scenario-actor', 'completion:verification-before-completion']);
  assert.deepEqual(kindSkills('qa', 'gate'), ['think:devils-advocate']);
  assert.equal(authorStage('qa'), 'cases');
});

test('neither draft/revise (planning) nor cases/execute (qa) is a reasoning stage - both mutate; only gate judges', () => {
  for (const s of ['draft', 'revise', 'cases', 'execute']) {
    assert.equal(REASONING_STAGES.has(s), false, `${s} should not be reasoning`);
  }
  assert.equal(REASONING_STAGES.has('gate'), true, 'gate stays reasoning, from BASE_REASONING');
  assert.equal(REASONING_STAGES.has('review'), true, 'document kind still contributes review');
});

test('execute carries a verdict field like test and review; revise and cases carry none, like draft and implement', () => {
  assert.equal(VERDICT_FIELD.execute, 'verified');
  assert.equal(VERDICT_FIELD.revise, undefined);
  assert.equal(VERDICT_FIELD.cases, undefined);
});

test('flow plan/qa supply their kind and a 3-persona list, the same shape as develop/document', () => {
  assert.equal(FLOWS.plan.kind, 'planning');
  assert.equal(FLOWS.plan.personas.length, 3);
  assert.equal(FLOWS.qa.kind, 'qa');
  assert.equal(FLOWS.qa.personas.length, 3);
});

test('kindOf is unaffected for unnamed and existing kinds, and resolves the two new ones', () => {
  assert.equal(kindOf({ id: 'U1' }), 'subgoal');
  assert.equal(kindOf({ id: 'D1', kind: 'planning' }), 'planning');
  assert.equal(kindOf({ id: 'Q1', kind: 'qa' }), 'qa');
});
```
- [ ] 2: `node --test graph-beta/scripts/test-graph.mjs` → import 대상이 없어 6개 모두 fail 확인
- [ ] 3: `graph-beta/mcp/graph.mjs`의 `KINDS` 선언(56-75행)을 바꾼다 — 기존 `subgoal`/`document`는 그대로 두고
  닫는 `};` 앞에 두 항목을 추가:
```js
export const KINDS = {
  subgoal: {
    chain: ['implement', 'test', 'gate'],
    reasoning: [],
    skills: {
      implement: ['develop:clean-code'],
      test: ['develop:testing-workflow', 'completion:verification-before-completion'],
      gate: ['think:devils-advocate'],
    },
  },
  document: {
    chain: ['draft', 'review', 'gate'],
    reasoning: ['review'],
    skills: {
      draft: ['write:doc-coauthoring'],
      review: ['write:writer-verification'],
      gate: ['think:devils-advocate'],
    },
  },
  // planning and qa both mutate on every authoring stage, unlike document's review: revise
  // rewrites the PRD itself (a different identity from draft, with edit rights - not only a
  // judge, per the design doc), and execute is qa's test - it runs the case set and reports
  // defects, not a verdict on someone else's claim. Neither belongs in `reasoning`; only the
  // closing `gate` judges. (The design doc's own table listed revise as reasoning while also
  // describing it as having edit rights - a contradiction; this follows document's precedent
  // instead: the mutating stage is never reasoning.)
  planning: {
    chain: ['draft', 'revise', 'gate'],
    reasoning: [],
    skills: {
      draft: ['pm:prd-development', 'write:doc-coauthoring'],
      revise: ['write:writer-verification', 'think:devils-advocate'],
      gate: ['think:devils-advocate'],
    },
  },
  qa: {
    chain: ['cases', 'execute', 'gate'],
    reasoning: [],
    skills: {
      cases: ['develop:test-master', 'develop:scenario-director'],
      execute: ['develop:scenario-actor', 'completion:verification-before-completion'],
      gate: ['think:devils-advocate'],
    },
  },
};
```
  `VERDICT_FIELD` 선언(105행)을 바꾼다:
```js
export const VERDICT_FIELD = { gate: 'accept', critique: 'sound', test: 'verified', review: 'verified', execute: 'verified' };
```
  `FLOWS` 선언을 바꾼다 — `document` 항목 뒤, 닫는 `};` 앞에 추가:
```js
export const FLOWS = {
  develop: {
    kind: 'subgoal',
    personas: ['implementer who owns the module being changed', 'test engineer who distrusts the implementation narrative', 'reviewer who has to maintain this code next year'],
  },
  document: {
    kind: 'document',
    personas: ['technical writer who has never seen this codebase', 'the reader the document is for - name their role', 'editor checking every claim against the source'],
  },
  // Flow name collides in spelling with the `plan` STAGE (the run's own decomposition node) -
  // different namespace, same word, because that is what the design doc names the entry skill.
  // A node id is never a flow name and vice versa, so nothing in the engine confuses them.
  plan: {
    kind: 'planning',
    personas: ['PO who owns value and scope', 'domain expert who owns terminology and rules', 'implementation lead reading for feasibility'],
  },
  qa: {
    kind: 'qa',
    personas: ['QA who represents the user', 'release manager weighing risk', 'someone deliberately trying malicious or malformed input'],
  },
};
export const DEFAULT_FLOW = 'develop';
```
- [ ] 4: `node --test graph-beta/scripts/test-graph.mjs` 6개 통과 확인
- [ ] 5: `git add graph-beta/mcp/graph.mjs graph-beta/scripts/test-graph.mjs && git commit -m "feat(graph-beta): KINDS.planning/qa, VERDICT_FIELD.execute, FLOWS.plan/qa"`

---

### Task 2: `prompts.mjs` — `CONTRACT.revise`/`CONTRACT.cases`/`CONTRACT.execute`
**Files:** modify `graph-beta/mcp/prompts.mjs`, modify `graph-beta/scripts/test-prompts.mjs`
**Interfaces:** produces 세 개의 `CONTRACT` 항목. `graph.mjs`의 `KINDS`에 의존하지 않는다 —
`composePrompt`는 `n.stage` 문자열만으로 룩업하므로 Task 1과 완전히 독립적으로 병행 가능.
**Pass bar:** `node --test graph-beta/scripts/test-prompts.mjs` 전체 통과(회귀 0), 새로 추가한 4개 포함.

- [ ] 1: 실패하는 테스트를 `graph-beta/scripts/test-prompts.mjs` 끝에 추가한다(기존 `tmpProject`/`baseRun`/
  `baseNode`/`baseBriefing` 헬퍼를 그대로 쓴다 — 새로 정의하지 않는다):
```js
// ---------- new-kind contracts: revise, cases, execute ----------

test('revise, cases and execute each get their own Required output contract, not the implement fallback', () => {
  const cwd = tmpProject();
  try {
    const run = baseRun(cwd);
    for (const stage of ['revise', 'cases', 'execute']) {
      const prompt = composePrompt(run, baseNode({ stage }), baseBriefing());
      assert.ok(prompt.includes('## Required output'));
      // The implement contract's own signature line - if this appears, the lookup fell
      // back instead of finding a contract keyed to this stage name.
      assert.doesNotMatch(prompt, /"handoff": "<paths, names, interfaces the dependent work needs>"/,
        `${stage} must not fall back to CONTRACT.implement`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('revise contract allows editing and asks for claim-vs-evidence checks, unlike review', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'revise' }), baseBriefing());
    assert.match(prompt, /you may edit the artifact/i);
    assert.match(prompt, /"changed_files"/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('execute contract asks for defects, forbids touching src/, and carries a verdict like test', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'execute' }), baseBriefing());
    assert.match(prompt, /"defects"/);
    assert.match(prompt, /do not touch src\//i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('cases contract writes a scenario spec derived from acceptance, not from the implementation', () => {
  const cwd = tmpProject();
  try {
    const prompt = composePrompt(baseRun(cwd), baseNode({ stage: 'cases' }), baseBriefing());
    assert.match(prompt, /scenario\/case specification/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```
- [ ] 2: `node --test graph-beta/scripts/test-prompts.mjs` → 새 4개가 fail 확인(나머지는 그대로 통과)
- [ ] 3: `graph-beta/mcp/prompts.mjs`의 `CONTRACT` 테이블에서 `review:` 항목과 `gate:` 항목 사이에 세 항목을 끼운다:
```js
  revise: `Return JSON: {"stage_ok": true|false, "handoff": "<what changed, then a one-paragraph abstract of what the document now says>", "changed_files": ["..."], "checks": ["claim -> the evidence you checked it against, or the passage you rewrote and why"], "evidence": "..."}
You are a different identity from draft, and unlike review you may edit the artifact - this is a second pass, not only a judgment. Rewrite for the reader who will actually use this document, and check every claim it makes against the evidence for it; a claim you cannot verify gets fixed or removed, not passed through. stage_ok=false when the artifact could not be revised. Do not report a file as changed unless you changed it.`,
  cases: `Return JSON: {"stage_ok": true|false, "handoff": "<path written, then a one-paragraph summary of what the case set covers>", "changed_files": ["..."], "checks": ["how you derived this case from the acceptance criteria, not from reading the implementation"], "evidence": "..."}
Write the scenario/case specification the acceptance describes, at the path the subgoal names - one case per behavior a user or an attacker could hit, not one per line of implementation. stage_ok=false when the case set could not be produced. Do not report a file as changed unless you changed it.`,
  execute: `Return JSON: {"stage_ok": true|false, "verified": true|false, "checks": ["case -> observed outcome"], "defects": ["what failed, and the minimal reproduction"], "evidence": "..."}
There is no separate test node in this chain - this is the test. Run the case set from cases against the tree exactly as written; do not edit it. stage_ok=false means a case could not be run at all. verified=false with stage_ok=true means one or more cases failed - list each in "defects" with enough detail for a develop fix to reproduce it. Write only under test/ or your own report path; do not touch src/.`,
```
- [ ] 4: 전체 통과 확인(회귀 0)
- [ ] 5: `git add graph-beta/mcp/prompts.mjs graph-beta/scripts/test-prompts.mjs && git commit -m "feat(graph-beta): CONTRACT.revise/cases/execute - the two new kinds no longer fall back to CONTRACT.implement"`

---

### Task 3: `mounts.mjs` — `GRAPH_STAGE_MOUNTS.draft`/`.cases`
**Files:** modify `graph-beta/mcp/mounts.mjs`, modify `graph-beta/scripts/test-mounts.mjs`
**Interfaces:** produces 두 개의 `GRAPH_STAGE_MOUNTS` 항목. Task 1·2와 파일이 겹치지 않아 완전히 독립적으로 병행 가능.
**Pass bar:** `node --test graph-beta/scripts/test-mounts.mjs` 전체 통과(회귀 0), 새로 추가한 2개 포함.

- [ ] 1: 실패하는 테스트를 `graph-beta/scripts/test-mounts.mjs`의 "stage-mounted MCP tools" 섹션 끝에 추가한다:
```js
test('draft and cases each get one advisory MCP tool by default, added for planning/qa', () => {
  const run = {};
  assert.deepEqual(graphStageMounts(run, node('draft:D1:1', 'draft', { subgoal_id: 'D1' })).map((m) => m.tool), ['mcp__think-tool__think']);
  assert.deepEqual(graphStageMounts(run, node('cases:Q1:1', 'cases', { subgoal_id: 'Q1' })).map((m) => m.tool), ['mcp__sequential-thinking__sequentialthinking']);
  // execute gets none by default, matching the design doc's "없음"
  assert.deepEqual(graphStageMounts(run, node('execute:Q1:1', 'execute', { subgoal_id: 'Q1' })), []);
});

test('a mounts override on draft does not touch cases, and vice versa', () => {
  const run = { mounts: { draft: [] } };
  assert.deepEqual(graphStageMounts(run, node('draft:D1:1', 'draft', { subgoal_id: 'D1' })), []);
  assert.deepEqual(graphStageMounts(run, node('cases:Q1:1', 'cases', { subgoal_id: 'Q1' })).map((m) => m.tool), ['mcp__sequential-thinking__sequentialthinking']);
});
```
- [ ] 2: `node --test graph-beta/scripts/test-mounts.mjs` → 새 2개가 fail 확인
- [ ] 3: `graph-beta/mcp/mounts.mjs`의 `GRAPH_STAGE_MOUNTS` 선언을 바꾼다:
```js
const GRAPH_STAGE_MOUNTS = {
  plan: [{ tool: 'mcp__sequential-thinking__sequentialthinking', use: 'stepping through the decomposition before you answer' }],
  setgoal: [{ tool: 'mcp__think-tool__think', use: 'reasoning through the acceptance criteria and subgoal shape before you answer' }],
  'gate:goal': [{ tool: 'mcp__mcp-reasoner__mcp-reasoner', use: 'weighing the evidence for and against acceptance before you answer' }],
  // draft is shared with the document kind - this stage name, not the planning kind alone, is
  // what the mechanism keys on, so a document draft gets the same advisory mount too. That is
  // a side effect of the design doc's plan (§3) asking for it on planning's draft specifically;
  // harmless, since a mount is advisory and skipped in silence when unconnected.
  draft: [{ tool: 'mcp__think-tool__think', use: 'reasoning through the problem framing and requirements before you write' }],
  cases: [{ tool: 'mcp__sequential-thinking__sequentialthinking', use: 'stepping through the behaviors a user or an attacker could hit before you write the case set' }],
};
```
- [ ] 4: 전체 통과 확인(회귀 0)
- [ ] 5: `git add graph-beta/mcp/mounts.mjs graph-beta/scripts/test-mounts.mjs && git commit -m "feat(graph-beta): mount draft/cases with an advisory MCP tool"`

---

### Task 4: `graph-beta:plan` entry 스킬
**Files:** create `graph-beta/skills/plan/SKILL.md`
**Interfaces:** consumes 없음(정적 문서) — `flow: "plan"`을 이름으로만 참조, Task 1의 `FLOWS.plan`이
실제로 존재해야 이 스킬이 의미 있게 동작하지만 파일 자체는 어떤 소스 파일과도 import 관계가 없어
Task 1-3·5·6과 완전히 병행 가능.
**Pass bar:** `python3 scripts/validate_plugins.py` graph-beta 관련 ERROR 0.

- [ ] 1: `develop`/`document`의 SKILL.md와 같은 구조로 작성한다
```markdown
---
name: plan
description: >-
  Use when the user has said, in their own words, that the deliverable is a PRD or product
  requirement write-up to run through the graph-beta harness — "기획서 그래프로", "PRD 작성해서
  그래프로 돌려줘", "run the planning flow", "write a PRD through the graph". Pins flow: plan.
  When they have not said which kind of work it is, use orchestrate instead. Not for
  installation, and not for a general design note or guide - use document for those.
effort: high
scenarios:
  - "Turn this feature request into a PRD through the harness, drafted then revised by a different reader"
  - "This is a planning job - PO value framing, domain rules, feasibility read, then gated"
  - "이건 기획 작업이야, PRD 초안→퇴고→게이트로 돌려줘"
  - "일반 문서 말고 PRD 흐름으로 고정해서 기획서 써줘"
compatibility:
  required:
    - graph-beta-engineering
related:
  - orchestrate
  - document
  - qa
---

# plan — the graph loop, flow pinned to product requirements

Same engine, same loop, one difference: the user has told you the deliverable is a PRD, so the
run does not ask the decomposition stage to choose a flow. Every subgoal that names no `kind` is
`planning` — `draft → revise → gate` — and the personas setgoal draws from are a PO who owns
value and scope, a domain expert who owns terminology and rules, and an implementation lead
reading for feasibility.

`revise` is a different identity from `draft` - the broker refuses a revise routed to the vendor
+ model that drafted, the same way it refuses a mismatched `document` review. Unlike `document`'s
`review`, `revise` may edit the artifact: it rewrites for the reader and checks every claim
against its evidence, rather than only judging what draft wrote.

The PRD itself is a node-written original, filled from `pm:prd-development`'s `template.md` (not
a rendered copy of it), at `<docs_dir>/E-<first 8 chars of task_id>/10-prd.md` (`docs_dir`
defaults to `.harness-run/team`; `team.json`'s key of the same name overrides it). Name that path
in the planning subgoal's `files[]` when the goal-spec is authored - there is no automatic
placement yet, only the plain `files[]` mechanism every subgoal already has.

## Entry

```
tm_open({
  request, cwd, isolated, mixed: true, flow: "plan",
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> task_id, ready: [size]
fresh agent at size.briefing_path -> tm_submit({task_id, node_id: "size", payload})
    delegate present     -> size S, s_driver "inline": one run, graph_open(delegate.args), then the loop
    task_state "s_run"   -> size S, s_driver "process" (the default): poll tm_next until it reports
    neither              -> a task of runs: ../orchestrate/references/manager.md
```

`size` measures build units and ownership boundaries the same way it does for `develop` and
`document`. The flow is pinned, so `size` does not choose one - it only measures. `mixed: true`
is deliberate: a PRD that also needs one supporting design note is one run, and the note is a
`document` subgoal inside it. Pass `mixed: false` only when the user said nothing may be
delivered but the PRD itself.

## Then

Run **`../orchestrate/references/loop.md`** yourself only for a delegated (`s_driver: "inline"`)
S run; otherwise poll `tm_next` exactly as `orchestrate` would. The Standing Mandates and Output
template in `../orchestrate/SKILL.md` apply unchanged.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts.

## What you do

Say it is a planning job. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, the decomposition stage picks the flow
- `document` — same loop, flow pinned to a general written artifact, not a PRD
- `qa` — same loop, flow pinned to test-case authoring and execution
```
- [ ] 2: `python3 scripts/validate_plugins.py 2>&1 | grep -i graph-beta` — ERROR 없음 확인(WARN은 허용)
- [ ] 3: `grep -c '^name: plan$' graph-beta/skills/plan/SKILL.md` → 1, `grep -c 'Use when' graph-beta/skills/plan/SKILL.md` → 1 이상 확인
- [ ] 4: `git add graph-beta/skills/plan/SKILL.md && git commit -m "docs(graph-beta): plan entry skill - flow pinned to PRD authoring"`

---

### Task 5: `graph-beta:qa` entry 스킬
**Files:** create `graph-beta/skills/qa/SKILL.md`
**Interfaces:** consumes 없음(정적 문서), Task 4와 마찬가지로 다른 모든 태스크와 완전히 병행 가능.
**Pass bar:** `python3 scripts/validate_plugins.py` graph-beta 관련 ERROR 0.

- [ ] 1: 작성한다
```markdown
---
name: qa
description: >-
  Use when the user has said, in their own words, that this is a QA pass - test cases written
  and executed against work that already exists - to run through the graph-beta harness —
  "QA 그래프로 돌려줘", "테스트 케이스 작성하고 실행해줘", "run the qa flow", "write and run test cases
  through the graph". Pins flow: qa. When they have not said which kind of work it is, use
  orchestrate instead. Not for installation, and not for writing the code itself - use develop
  for that.
effort: high
scenarios:
  - "Write test cases for this feature and execute them against the tree, reporting defects"
  - "This is a QA job - cases from a user's and an attacker's perspective, then executed and gated"
  - "이건 QA 작업이야, 케이스 작성→실행→게이트로 돌려줘"
  - "구현 말고 QA 흐름으로 고정해서 테스트 케이스 뽑고 돌려줘"
compatibility:
  required:
    - graph-beta-engineering
related:
  - orchestrate
  - develop
  - plan
---

# qa — the graph loop, flow pinned to test-case authoring and execution

Same engine, same loop, one difference: the user has told you this is a QA pass, so the run does
not ask the decomposition stage to choose a flow. Every subgoal that names no `kind` is `qa` —
`cases → execute → gate` — and the personas setgoal draws from are a QA who represents the user,
a release manager weighing risk, and someone deliberately trying malicious or malformed input.

There is no `test` node in this chain - `execute` is the test: it runs the case set `cases` wrote
against the tree exactly as written and reports failures as defects, not as a narrative. `execute`
may write under `test/` or its own report path; it must not touch `src/` - that boundary is what
the engine's changed-file check is for. A qa subgoal's `deps[]` should name the develop work it is
checking, so it never runs before there is anything to check.

## Entry

```
tm_open({
  request, cwd, isolated, mixed: true, flow: "qa",
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> task_id, ready: [size]
fresh agent at size.briefing_path -> tm_submit({task_id, node_id: "size", payload})
    delegate present     -> size S, s_driver "inline": one run, graph_open(delegate.args), then the loop
    task_state "s_run"   -> size S, s_driver "process" (the default): poll tm_next until it reports
    neither              -> a task of runs: ../orchestrate/references/manager.md
```

`size` measures the same way it does for `develop` and `document`. The flow is pinned, so `size`
does not choose one - it only measures. `mixed: true` is deliberate: a QA pass that also needs
one supporting fix is one run, and the fix is a `subgoal` inside it. Pass `mixed: false` only when
the user said nothing may change but the case set and its report.

## Then

Run **`../orchestrate/references/loop.md`** yourself only for a delegated (`s_driver: "inline"`)
S run; otherwise poll `tm_next` exactly as `orchestrate` would. The Standing Mandates and Output
template in `../orchestrate/SKILL.md` apply unchanged.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts.

## What you do

Say it is a QA pass. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, the decomposition stage picks the flow
- `develop` — same loop, flow pinned to the code the qa pass checks
- `plan` — same loop, flow pinned to the PRD this work traces back to
```
- [ ] 2: `python3 scripts/validate_plugins.py 2>&1 | grep -i graph-beta` — ERROR 없음 확인
- [ ] 3: `grep -c '^name: qa$' graph-beta/skills/qa/SKILL.md` → 1 확인
- [ ] 4: `git add graph-beta/skills/qa/SKILL.md && git commit -m "docs(graph-beta): qa entry skill - flow pinned to test-case authoring and execution"`

---

### Task 6: bench 요청 파일 — `plan-flat`/`qa-flat`
**Files:** create `graph-beta/scripts/bench/requests/plan-flat.txt`, create `graph-beta/scripts/bench/requests/qa-flat.txt`
**Interfaces:** 소비 없음. 둘 다 이미 있는 `fixtures/tinyq` 픽스처를 겨냥한다(새 픽스처 없음) —
다른 모든 태스크와 완전히 병행 가능.
**Pass bar:** 두 파일이 존재하고 비어 있지 않다. `ls graph-beta/scripts/bench/fixtures/tinyq/src` 로
참조한 파일 경로(`queue.mjs`/`worker.mjs`/`retry.mjs`)가 실제로 있음을 확인.

- [ ] 1: `graph-beta/scripts/bench/requests/plan-flat.txt`
```
Write a PRD for adding a priority-aware processing mode to this small Node queue library `tinyq` (src/queue.mjs schedules FIFO batches, src/worker.mjs pulls and runs them, src/retry.mjs governs re-attempts). The PRD must cover: the problem existing users hit with pure FIFO ordering under mixed-priority load; the target user and their job-to-be-done; why this is worth doing now; a solution overview naming the specific API surface that changes; the primary metric that would show it worked; user stories with acceptance criteria an engineer could hand off from; what is explicitly out of scope for a first version; the technical dependencies and risks of touching the existing retry path; and the open questions still unresolved. Every requirement must be checkable against something a reader can point to in the PRD itself - no aspirational or unverifiable claims. Do not change any code - the deliverable is the PRD document alone.
```
- [ ] 2: `graph-beta/scripts/bench/requests/qa-flat.txt`
```
Write test cases for and execute against the existing behavior of this small Node queue library `tinyq` (src/queue.mjs, src/worker.mjs, src/retry.mjs already have unit tests under test/, but no dedicated QA pass). Deliver: (1) a case set under test/qa/ covering the user-facing behavior a person integrating this library would rely on - enqueue/dequeue ordering, what happens when a worker throws mid-job, whether a retried job can be double-processed, behavior when the queue is drained concurrently - written from a user's and an attacker's perspective, not from the implementation; (2) execute every case against the tree exactly as written and report the outcome of each; (3) for every case that fails, a defect entry with the minimal reproduction, not a narrative description. Do not modify anything under src/ - a QA pass that changes the implementation it is checking cannot be trusted. Every claim of a pass or a failure must point to what was actually run and what it printed.
```
- [ ] 3: `ls graph-beta/scripts/bench/fixtures/tinyq/src/queue.mjs graph-beta/scripts/bench/fixtures/tinyq/src/worker.mjs graph-beta/scripts/bench/fixtures/tinyq/src/retry.mjs` — 셋 다 존재 확인
- [ ] 4: `git add graph-beta/scripts/bench/requests/plan-flat.txt graph-beta/scripts/bench/requests/qa-flat.txt && git commit -m "test(graph-beta): bench requests for the planning and qa kinds, against the existing tinyq fixture"`

---

### Task 7: `broker.mjs` — revise도 review와 같은 정체성 분리 강제 + 통합 테스트
**Files:** modify `graph-beta/mcp/broker.mjs`, modify `graph-beta/scripts/test-broker.mjs`
**Interfaces:** consumes Task 1(`KINDS.planning`/`KINDS.qa`/`VERDICT_FIELD.execute`/`FLOWS.plan`/`FLOWS.qa`),
Task 2(`CONTRACT.revise`/`.cases`/`.execute`), Task 3(`GRAPH_STAGE_MOUNTS.draft`/`.cases`) — 이 셋이
먼저 합쳐져야 실제 MCP 서버가 두 kind를 온전히 펼친다. produces `reviewIndependence`가 `revise`에도
적용되는 동작.
**Pass bar:** `node --test graph-beta/scripts/test-broker.mjs` 전체 통과(회귀 0), 새로 추가한 3개 포함.

- [ ] 1: 실패하는 테스트 세 개를 `test-broker.mjs`에 추가한다. 첫째, "document kind" 섹션(§ "a mixed spec
  expands each subgoal by its kind and reaches the report" 바로 뒤)에 두 개를 놓는다 — 같은 파일 상단의
  `withRun`/`throughCritiqueWith`/`ok`/`dirty` 헬퍼를 그대로 쓴다:
```js
// ---------- planning and qa kinds ----------

const PLANNING_QA_MIX = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [
    { id: 'P1', kind: 'planning', title: 'PRD for priority mode', acceptance: ['names the problem', 'states the target user'], files: ['.harness-run/team/E-deadbeef/10-prd.md'], deps: [] },
    { id: 'Q1', kind: 'qa', title: 'QA the priority mode', acceptance: ['covers ordering under load'], files: ['test/qa/priority.md'], deps: ['P1'] },
  ],
};

test('a mixed spec expands a planning subgoal into draft->revise->gate and a qa subgoal into cases->execute->gate', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, PLANNING_QA_MIX);
    const st = await c.call('graph_status', { run_id: runId, cwd });
    const ids = st.nodes.map((n) => n.node_id);
    assert.ok(ids.includes('draft:P1:1') && ids.includes('revise:P1:1') && ids.includes('gate:P1:1'));
    assert.ok(ids.includes('cases:Q1:1') && ids.includes('execute:Q1:1') && ids.includes('gate:Q1:1'));
    assert.ok(!ids.includes('implement:P1:1') && !ids.includes('test:P1:1'), 'planning has no implement/test');
    assert.ok(!ids.includes('implement:Q1:1') && !ids.includes('test:Q1:1'), 'qa has no implement/test either - execute is the test');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'cases:Q1:1').deps, ['gate:P1:1'], "qa's own deps[] on the planning subgoal carries through");

    const f = dirty(cwd);
    const d = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'draft:P1:1', payload: ok({ changed_files: [f], handoff: 'PRD drafted' }) });
    assert.equal(d.state, 'done', JSON.stringify(d));
    const rv = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'revise:P1:1', payload: ok({ changed_files: [], handoff: 'revised for the reader' }) });
    assert.equal(rv.state, 'done', JSON.stringify(rv));
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:P1:1', payload: ok({ accept: true, match_pct: 95 }) });

    const g = dirty(cwd, 'b.txt');
    const cs = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'cases:Q1:1', payload: ok({ changed_files: [g], handoff: 'case set written' }) });
    assert.equal(cs.state, 'done', JSON.stringify(cs));
    const ex = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'execute:Q1:1', payload: ok({ verified: true }) });
    assert.equal(ex.state, 'done', JSON.stringify(ex));
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:Q1:1', payload: ok({ accept: true, match_pct: 95 }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  });
});

test('a rejected qa execute gets a fresh cases/execute pair, the same reassignment review gets for a rejected document', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'Q1', kind: 'qa', title: 'qa pass', acceptance: ['a'], deps: [] }],
    });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'cases:Q1:1', payload: ok({ changed_files: [], handoff: 'cases v1' }) });
    const rv = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'execute:Q1:1', payload: ok({ verified: false, defects: ['double-processed a retried job -> reproduce with 2 workers and a forced retry'] }) });
    assert.deepEqual(rv.reassigned, { target: 'subgoal', subgoal_id: 'Q1', attempt: 2 });
    const ids = (await c.call('graph_status', { run_id: runId, cwd })).nodes.map((n) => n.node_id);
    assert.ok(ids.includes('cases:Q1:2') && ids.includes('execute:Q1:2'));
  });
});
```
  둘째, `documentRepo()`/review 정체성 테스트("a review routed to the identity that wrote the draft is
  refused...") 바로 뒤에 세 번째를 놓는다:
```js
test('a revise routed to the identity that drafted is refused, the same way review is', async () => {
  const cwd = documentRepo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('graph_open', {
      request: 'r', cwd, vendor: 'self',
      policy: { draft: { vendor: 'ink', model: 'm1' }, revise: { vendor: 'ink', model: 'm1' } },
    });
    await throughCritiqueWith(c, cwd, run_id, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'P1', kind: 'planning', title: 'prd', acceptance: ['a'], files: ['prd.md'], deps: [] }],
    });
    const d = await c.call('graph_run', { run_id, cwd, node_id: 'draft:P1:1' });
    assert.equal(d.state, 'done', JSON.stringify(d));
    assert.equal(d.executor, 'ink');

    const refused = await c.call('graph_run', { run_id, cwd, node_id: 'revise:P1:1' });
    assert.match(refused.error, /someone other than its author/);
    const st = await c.call('graph_status', { run_id, cwd, node_id: 'revise:P1:1' });
    assert.equal(st.nodes[0].state, 'pending', 'a routing mistake costs no retry');

    const r = await c.call('graph_run', { run_id, cwd, node_id: 'revise:P1:1', model: 'm2' });
    assert.equal(r.state, 'done', JSON.stringify(r));
    // reviewer_independence itself is only merged into the result on the reasoning branch
    // of graph_run/graph_submit; revise is not a reasoning stage (Task 1), so the refusal
    // applies here but the provenance field does not surface - left out of scope (see the
    // plan's 발견 6).
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});
```
- [ ] 2: `node --test graph-beta/scripts/test-broker.mjs` → 새 3개가 fail 확인(둘째 테스트는 KINDS가
  아직 없어도 "planning"/"qa" kind 자체는 실패하지 않을 수 있으나 - 이 태스크는 Task 1·2·3 완료 후에만
  실행하므로 실제로는 셋 다 fail한다: `reviewIndependence`가 아직 `revise`를 모른다)
- [ ] 3: `graph-beta/mcp/broker.mjs`의 `reviewIndependence` 함수를 바꾼다:
```js
function reviewIndependence(run, n, executor, model) {
  // revise (planning kind) makes the same "not the same identity as the author" demand
  // review does - the design doc's decision that a different identity revises. The
  // reviewer_independence field is still merged into the result only on the reasoning
  // branch below (graph_run/graph_submit); revise is not a reasoning stage, so only the
  // refusal (the throw below) applies to it, not the field.
  if (n.stage !== 'review' && n.stage !== 'revise') return null;
  const kind = nodeKind(run, n);
  const author = run.nodes.find((x) => x.subgoal_id === n.subgoal_id
    && (x.attempt || 1) === (n.attempt || 1) && x.stage === authorStage(kind || 'subgoal'));
  if (!author || !author.result) return null;
  const mine = identityOf(executor, model);
  const theirs = identityOf(author.executor || author.vendor, author.model);
  if ((executor || 'self') === 'self' || (author.executor || author.vendor || 'self') === 'self') {
    return { independence: 'unverifiable-self', author: theirs, reviewer: mine };
  }
  if (mine === theirs) {
    throw new Error(`${n.stage} ${n.node_id} is routed to ${mine}, which wrote ${author.node_id}. `
      + `A document must be read or revised by someone other than its author: route the ${n.stage} stage to another vendor `
      + `(policy.${n.stage}) or pass a different model to graph_run.`);
  }
  return { independence: 'distinct-identity', author: theirs, reviewer: mine };
}
```
  같은 파일의 `TOOLS`(도구 스키마) 안 `reviewer_independence` 필드 설명을 고친다:
  `description: 'review nodes: whether the broker could see that the reviewer is not the draft author'`
  → `description: 'review and revise nodes: whether the broker could see that the reviewer is not the draft author'`
- [ ] 4: 전체 통과 확인(회귀 0)
- [ ] 5: `git add graph-beta/mcp/broker.mjs graph-beta/scripts/test-broker.mjs && git commit -m "feat(graph-beta): planning/qa kinds reach the broker - revise gets review's identity-separation guard, execute reassigns like test"`

---

### Task 8: 릴리스 0.10.1 — 버전, Status, 전체 검증
**Files:** modify `graph-beta/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`(graph-beta 항목
version + description), `graph-beta/README.md`, `graph-beta/KOR.md`
**Interfaces:** consumes Task 1-7 전부.
**Pass bar:** `node --test graph-beta/scripts/test-*.mjs` 전부 통과(회귀 0), `python3 scripts/validate_plugins.py`
ERROR 0, 두 매니페스트 0.10.1 일치, README·KOR Status 첫 항목이 v0.10.1.

- [ ] 1: `git fetch skills main && git status -sb` — origin이 앞서 있으면 rebase
- [ ] 2: `node --test graph-beta/scripts/test-*.mjs 2>&1 | tail -8` → `# fail 0` 확인
- [ ] 3: patch 범프: `graph-beta/.claude-plugin/plugin.json`과 `.claude-plugin/marketplace.json`의 graph-beta
  `"version": "0.10.0"` → `"0.10.1"`; marketplace description 끝(현재 "...so it coexists with the harness
  plugin." 뒤)에 " Adds planning (draft→revise→gate) and qa (cases→execute→gate) kinds with their own
  personas/skills/MCP mounts, and graph-beta:plan/graph-beta:qa entry skills." 추가
- [ ] 4: README `## Status` 맨 위, KOR `## 상태` 맨 위에 한 줄씩 prepend(기존 v0.10.0 항목은 그 아래 그대로 둔다):
  - README: `- **v0.10.1 — planning and qa kinds**: two new KINDS entries, draft→revise→gate and
    cases→execute→gate, with their own personas, per-stage skills and MCP mounts (§3), and two new
    entry skills, graph-beta:plan and graph-beta:qa, that pin the flow the same way develop/document
    do. revise now gets the same author-independence guard review has - a revise routed to the
    vendor+model that drafted is refused. Not done yet: wiring planning/qa into the EPIC flow itself
    (planning before shape, qa after integrate, defect STORYs) - that needs the ticket/board layer,
    v0.11.0+.`
  - KOR: 같은 내용을 한국어로.
- [ ] 5: `python3 scripts/validate_plugins.py` ERROR 0 확인
- [ ] 6: `git add graph-beta/.claude-plugin/plugin.json .claude-plugin/marketplace.json graph-beta/README.md graph-beta/KOR.md && git commit -m "feat(graph-beta): 0.10.1 - planning/qa kinds, personas/skills/mounts, plan/qa entry skills"`
- [ ] 7: `git push skills main`(저장소 규칙. 실패하면 1번으로 돌아가 fetch·rebase 후 재시도)

---

## 자기 검토

- **소비/생산 연결**: Task 7은 Task 1(`KINDS`/`VERDICT_FIELD`/`FLOWS`)·Task 2(`CONTRACT`)·Task 3
  (`GRAPH_STAGE_MOUNTS`)이 전부 합쳐진 뒤에만 의미 있게 통과한다 — 셋 다 broker.mjs가 기동하는 실제
  MCP 서버 안에서 조합되기 때문(Task 2·3만으로는 `composePrompt`/`mountBlock`이 도달 가능하지만
  `KINDS.planning`/`qa`가 없으면 `graph_open`이 그 kind로 확장할 스펙 자체를 만들 수 없다). Task 8은
  Task 7까지 전부의 위에 선다.
- **파일 충돌 없음**: Task 1(graph.mjs+test-graph.mjs), Task 2(prompts.mjs+test-prompts.mjs), Task 3
  (mounts.mjs+test-mounts.mjs), Task 4(skills/plan/SKILL.md), Task 5(skills/qa/SKILL.md), Task 6(bench
  requests 2개) — 이 여섯은 서로 파일이 하나도 겹치지 않아 6-way 병렬 가능. Task 7(broker.mjs+
  test-broker.mjs)만 이 여섯 중 셋(1·2·3)의 완료를 필요로 한다. Task 8은 매니페스트·README·KOR만
  건드리고 다른 모든 태스크가 만든 파일을 읽지 않으므로, "파일이 겹쳐 직렬화해야 하는 두 태스크" 쌍은
  이 계획에 없다 — Task 7 자신이 test-broker.mjs를 세 군데(문서 섹션 하나, 정체성 섹션 하나) 나눠
  건드리지만 한 태스크 안이라 충돌이 아니다.
- **이름 일관성**: `KINDS.planning`/`KINDS.qa`의 체인·스킬 이름은 Task 1의 선언이 유일한 정의이고
  Task 2(CONTRACT 룩업 키)·Task 3(GRAPH_STAGE_MOUNTS 룩업 키)·Task 7(테스트의 node_id 접두어)이 전부
  그 이름(`draft`/`revise`/`cases`/`execute`)을 그대로 재사용한다. `FLOWS.plan`/`FLOWS.qa`의 `kind`
  필드값(`'planning'`/`'qa'`)도 Task 1이 유일한 정의.
- **모호 지점 해소**: (a) revise를 reasoning으로 볼지 저작(mutating)으로 볼지 — §3 자기모순을
  document kind 선례로 저작 쪽으로 정정(발견 1). (b) `pm:user-story` 스킬 부재 — 그냥 뺌(발견 2).
  (c) mounts가 kind가 아니라 스테이지 이름으로 키가 잡혀 draft mount가 document에도 새는 것 —
  advisory라 무해하다고 보고 그대로 둠, 기록만 남김(발견 3). (d) revise의 정체성 분리를 예외(거부)로만
  강제하고 결과 payload의 `reviewer_independence` 필드 병합까지는 넓히지 않음 — 범위를 최소로 유지하기
  위한 의도적 경계(Task 7 스텝 1 마지막 테스트의 주석).
- **위험**: Task 7의 첫 테스트가 쓰는 PRD 경로(`.harness-run/team/E-deadbeef/10-prd.md`)는 team-lead가
  고정한 산출물 자리를 그대로 딴 값이다 — `task8`을 실제로 계산하는 코드는 이번 라운드에 없으므로
  테스트는 그 경로가 그냥 `files[]`에 이름 붙었을 때 draft 노드가 정상적으로 그 서브골 아래서 도는지만
  본다. 자동 계산(`docs.mjs`)이 없다는 사실과 모순되지 않는다.
- **위험**: `documentRepo()`의 가짜 `ink` 어댑터는 `stage === 'draft'`일 때만 파일을 쓴다 — `revise`
  스테이지에서는 아무 파일도 바꾸지 않은 채 `verified: true`만 돌려준다. Task 7의 세 번째 테스트는
  파일 변경 여부를 검증하지 않고 정체성 거부/허용만 검증하므로 문제 없다.
