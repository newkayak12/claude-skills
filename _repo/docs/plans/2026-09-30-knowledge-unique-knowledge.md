# knowledge — 볼트 고유 지식 중심 재정향 Implementation Plan

> Produced by write:writing-plans. Owner for execution routing: planning:executing-plans.
> Steps use checkbox (`- [ ]`) syntax. 상태: **plan — 승인 전** (CLAUDE.md Design Changes 1단계).

**Goal:** 볼트의 가치를 "grep보다 잘 찾는다"가 아니라 "소스에 없는 지식을 답한다"로 재정의하고, 그걸 잴 수
있게 만들고, 볼트가 쌓이는 동안 낡지 않게 한다.

**Architecture:** 측정은 기존 벤치(`~/Projects/knowledge-chat/bench/`)와 `sqlite-knowledge.mjs eval`을 그대로
쓰고, 질문에 `answer_source` 태그 하나를 추가해 결과를 버킷별로 나눈다. 유지 루프는 노트 `sources:`의 해시를
기록해 stale을 검출하고, 소비자 없는 훅 큐는 drain하거나 제거한다.

**Tech Stack:** Node 24 (`node:sqlite`), `node --test`, GitHub Actions, 기존 bench 스크립트.

**근거:** `knowledge/docs/critique/2026-09-30-*.md` (기준 의견 + 페르소나 4 + 종합).

---

## 조사로 바뀐 전제 (2026-09-30)

- **코퍼스는 1개가 아니다.** `~/Projects/knowledge-chat`에 다도메인 볼트(노트 4,168개, 질문 212개, 도메인
  wms·oms·invoice·settlement·account·oncall·platform)가 있고 벤치 하네스(`knowledge-agent[-claude].mjs`,
  `knowledge-grade.mjs`, `knowledge-compare.mjs`)도 있다. 비판 00의 "N=1"은 **플러그인 문서에 기록된 측정**이
  94문항 하나라는 뜻으로 좁혀진다. → 두 번째 코퍼스는 새로 만들 필요 없이 여기서 쓴다.
- **드리프트는 실측된 문제다.** knowledge-chat 커밋 `a6d71ed` "코드와 어긋난 기존 노트를 정정한다".
- **큐 미소비는 실측된 문제다.** knowledge-chat `vault/_knowledge/jobs/`에 `catalog-delta-queue`·`embed-queue`
  각 616줄 누적, 소비 흔적 없음.
- **212문항에는 `kind`가 없다**(`{id, question, required_note_ids, repo}`). 태그는 새로 붙여야 한다.
- CI(`.github/workflows/validate-plugins.yml`)는 `python3 _repo/scripts/validate_plugins.py`만 돈다. 로컬 Node 22.12.

## 범위 밖 (명시적 동결)

새 검색 레버(시간 축, 리랭커 튜닝, 청크 규칙 추가), 새 스킬, theory.md 확장, Phase 4b. Task 5 결과 전까지.

---

### Task 1: CI 안전망 — knowledge 테스트를 CI에서 돌린다
**Files:** modify `.github/workflows/validate-plugins.yml`.
**Interfaces:** produces — 이후 모든 Task의 회귀 검출 수단.
**Pass bar:** PR에서 `knowledge-tests` 잡이 Node 24로 `sqlite-knowledge.test.mjs`(45개), `validate-knowledge.test.mjs`,
`knowledge-delta-check.test.mjs`를 실행하고 green.

- [ ] 1: 잡 추가
  ```yaml
    knowledge-tests:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '24' }
        - run: node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs
  ```
- [ ] 2: 브랜치 push → 잡 결과 확인. 실패하면 FTS5 빌드 여부부터 본다(`RUNTIME_HINT`, sqlite-knowledge.mjs:24).
- [ ] 3: commit `ci(knowledge): run the knowledge tests on Node 24`

### Task 2: 튜닝 상수 고정 테스트
**Files:** modify `knowledge/scripts/sqlite-knowledge.mjs` (export 목록, :2123), create
`knowledge/scripts/sqlite-knowledge.constants.test.mjs`.
**Interfaces:** consumes Task 1 CI / produces `TUNING` export — Task 6 ablation이 참조.
**Pass bar:** 상수 하나를 바꾸면 이 테스트가 실패하고, 실패 메시지가 "측정 근거 없이 바꾸지 말 것 — ROADMAP 기록 필요"를 출력.

- [ ] 1: 실패 테스트 작성
  ```js
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { TUNING } from './sqlite-knowledge.mjs';

  const PINNED = {
    RRF_K: 60,
    COLUMN_RRF_WEIGHTS: { title: 0.5, terms: 0.35, body: 0.15 },
    RELATION_RRF_WEIGHT: 0.35,
    RELATION_PARTICIPANT_WINDOW_SHARE: 0.5,
    RELATION_SOURCE_RANK_LIMIT: 8,
    RELATION_PARTICIPANT_FLOOR: 2,
    MAX_QUERY_TOKENS: 24,
    DEFAULT_HOLDOUT_RATIO: 0.35,
    DECISIVE_P: 0.05,
  };

  test('tuning constants change only with a recorded measurement', () => {
    assert.deepEqual(TUNING, PINNED,
      'Tuning constant changed. Record the measurement in ROADMAP.md, then update PINNED.');
  });
  ```
- [ ] 2: `node --test`로 실패 확인(`TUNING` 미정의).
- [ ] 3: `sqlite-knowledge.mjs` export 블록에 `TUNING: { RRF_K, COLUMN_RRF_WEIGHTS, ... }` 추가(값 복사가 아니라 기존 상수 참조).
- [ ] 4: 통과 확인. 5: commit `test(knowledge): pin the tuning constants to their measurement`

### Task 3: 질문 태그 `answer_source` — 계약과 검증기
**Files:** modify `knowledge/skills/knowledge-base-builder/references/answerability-contract.md`,
`knowledge/scripts/validate-knowledge.mjs`, `knowledge/scripts/validate-knowledge.test.mjs`.
**Interfaces:** produces 필드 `answer_source ∈ {"source", "vault-only", "mixed"}` — Task 4·5가 소비.
- `source`: 답이 코드/문서 원문에 그대로 있다(grep으로 도달 가능).
- `vault-only`: 답이 결정 이유·운영자 용어·폐기된 선택지·모듈 간 대조처럼 소스 원문에 없다.
- `mixed`: 일부만 소스에 있다.
**Pass bar:** 잘못된 값(`"foo"`)이면 검증기가 에러, 필드 없으면 경고만(기존 볼트 호환), 테스트 green.

- [ ] 1: 실패 테스트 2개(잘못된 값 → error, 누락 → warning 1건) 작성 → 실패 확인.
- [ ] 2: `QUESTION_KINDS` 옆에 `ANSWER_SOURCES` 집합과 검사 추가(validate-knowledge.mjs:9 인근, :222 검사 패턴 따름).
- [ ] 3: 계약 문서에 정의 3줄 + 판정 규칙 "원문에서 답 문장을 인용할 수 있으면 source"를 추가.
- [ ] 4: 통과 확인. 5: commit `feat(knowledge): tag each competency question by where its answer lives`

### Task 4: 212문항 태깅 (측정 준비, knowledge-chat)
**Files:** modify `~/Projects/knowledge-chat/_knowledge/questions.jsonl`; create
`~/Projects/knowledge-chat/_knowledge/answer-source-tagging.md`(판정 근거 표).
**Interfaces:** consumes Task 3 정의 / produces 태그된 212문항 — Task 5가 소비.
**Pass bar:** 212/212에 `answer_source`가 있고, 무작위 20문항을 두 번째 판정자(별도 서브에이전트, 태그 미공개)가
다시 판정해 일치율을 기록. 일치율 < 80%면 Task 3 정의로 돌아간다.

- [ ] 1: 질문마다 `required_note_ids` 노트의 `sources:`를 열어 답 문장이 원문에 있는지 판정 → 태그 + 근거 1줄.
- [ ] 2: 20문항 재판정 → 일치율 기록.
- [ ] 3: knowledge-chat에 commit (플러그인 저장소 아님).

### Task 5: 버킷별 측정 — 볼트 대 무볼트 (판정 게이트)
**Files:** create `~/Projects/knowledge-chat/bench/knowledge-agent-novault.mjs`(knowledge-agent-claude.mjs 복제,
툴을 볼트 4종 대신 원본 레포 Grep/Read로 교체), 결과 `bench/results/2026-10-*.jsonl`, 보고
`knowledge/docs/critique/2026-10-XX-bucket-measurement.md`.
**Interfaces:** consumes Task 4 태그, 기존 `knowledge-grade.mjs` / produces 버킷별 hit·partial·miss 표 — 방향 분기 근거.
**Pass bar:** 같은 212문항에 대해 (a) 무볼트 (b) 볼트+`knowledge-query` 두 실행의 grade 결과가
`source / vault-only / mixed` 버킷별로 표에 있다. 무볼트 실행은 채점 기준이 노트가 아니므로 **답의 핵심 사실 일치**를
사람이 표본 30문항에 대해 판정(채점자≠피채점자, knowledge-grade.mjs 주석의 원칙).

- [ ] 1: novault 드라이버 작성, `--limit 5` 스모크.
- [ ] 2: 전체 실행 (a)(b). 비용·시간 기록.
- [ ] 3: 버킷별 표 + 판정.
- [ ] 4: **분기 규칙**(미리 고정):
  - `vault-only`에서 (b)가 (a)를 명확히 이기고 `source`에서 비슷 → 가설 확인. Task 7로.
  - `source`에서도 (b)가 크게 이김 → 검색 엔진도 가치 있음. Task 6(ablation)을 먼저.
  - `vault-only`에서도 차이 없음 → 볼트 전략 재검토, 이 계획 중단하고 사용자와 재논의.

### Task 6: ablation (Task 5 분기 2일 때만)
**Files:** `sqlite-knowledge.mjs eval` 옵션만 사용; 보고 `knowledge/docs/critique/2026-10-XX-ablation.md`.
**Interfaces:** consumes Task 2 `TUNING`.
**Pass bar:** BM25 단독 / 임베딩 단독 / 융합, 한국어 접두어 on/off, relation 승격 on/off 각각의 dev·holdout MRR 표.
효과가 부호 검정 p ≥ 0.05인 규칙은 제거 후보로 목록화(제거 자체는 별도 승인).

### Task 7: 유지 루프 — stale 검출
**Files:** modify `knowledge/scripts/validate-knowledge.mjs`(+test), `knowledge/skills/knowledge-base-builder/SKILL.md`
(`sources:` 항목, :117), 계약 문서.
**Interfaces:** produces 카탈로그 필드 `source_hashes: {path: sha256}`와 검증기 옵션 `--check-stale <source-root>`.
**Pass bar:** 테스트 픽스처에서 소스 파일 한 줄을 바꾸면 해당 노트가 `stale`로 보고되고, 안 바꾸면 0건.
knowledge-chat에 돌려 stale 비율을 숫자로 기록.

- [ ] 1: 실패 테스트(소스 변경 → stale 1건) → 실패 확인.
- [ ] 2: 해시 기록은 빌더 규칙, 비교는 검증기(`createHash` 이미 사용 중, validate-knowledge.mjs:103).
- [ ] 3: 통과 → knowledge-chat 실측 → commit `feat(knowledge): report notes whose sources changed since they were written`

### Task 8: 훅 큐 — drain하거나 지운다
**Files:** `knowledge/hooks/knowledge-delta-check.mjs`(+test), `knowledge/scripts/sqlite-knowledge.mjs` 또는 README.
**Interfaces:** consumes Task 7 (stale이 있으면 catalog-delta 큐의 역할 일부를 대체).
**Pass bar:** 둘 중 하나 — (A) `sqlite-knowledge.mjs drain`이 큐를 읽어 재색인 후 큐를 비우고, knowledge-chat의 616줄이
0이 된다. 또는 (B) 훅이 큐를 더 쓰지 않고 `delta-checks.jsonl` 보고만 남긴다. 선택은 Task 7 결과를 보고 승인받는다
(v1.15.0의 해시 기반 전체 재색인이 이미 있어 (B)가 더 단순할 가능성이 높음).

### Task 9: 빌더 우선순위 규칙 (Task 5 분기 1일 때)
**Files:** `knowledge-base-builder/SKILL.md`, `knowledge-workflow/SKILL.md`, README/KOR.
**Pass bar:** 빌더 규칙에 "vault-only 지식(결정·운영자 용어·대조·폐기 선택지)을 먼저, 코드 요약 노트는 질문이 요구할 때만"이
들어가고, knowledge-workflow의 성장 지표가 "답할 수 있는 vault-only 질문 수"로 바뀐다. 버전 bump + README/KOR 동시 갱신.

---

## 순서와 게이트

```
T1 → T2 ─┐
T3 → T4 → T5 ──분기1──→ T9
          │    └분기2──→ T6
          └──────────→ T7 → T8
```
T1–T4는 병렬 가능(T1·T2 / T3·T4). T5가 유일한 판정 게이트. T7·T8은 T5와 무관하게 진행(점진적 성장의 전제).

## 승인이 필요한 지점 (CLAUDE.md Design Changes)
- 이 계획 자체 (지금).
- T5 분기 결과 → T6/T9 착수.
- T6의 규칙 제거, T8의 (A)/(B) 선택.
- T3·T7·T9는 플러그인 동작 변경 → 버전 bump. push는 보류(메모리: hold push and version bump).
