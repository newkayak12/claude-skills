# knowledge — 한국어

[English](README.md) · **한국어**

코드베이스, 문서 묶음, 뒤섞인 노트를 **실제로 질문에 답할 수 있는** 지식 시스템으로 만드는
스킬 모음입니다. 깔끔해 보이기만 한 볼트가 아니라요. 이 플러그인의 모든 빌더는
**응답 가능성(answerability)** 을 완료 조건으로 겁니다 — 볼트는 자기 컴피턴시 질문에
인용 근거로 답할 수 있어야 완성이고, 검색 품질은 감이 아니라 숫자로 잽니다.

로컬 MCP 서버(`knowledge-local`)가 볼트를 일회용 SQLite로 색인해 하이브리드 전문 검색과
그래프 탐색을 제공하고, 편집 후 훅이 지식 워크스페이스 안의 Markdown 변경을 감지해 후속
작업을 큐에 넣습니다.

## 설치 / 제거

```bash
/plugin install knowledge@newkayak12-claude-skills
/plugin uninstall knowledge@newkayak12-claude-skills
```

설치하면 현재 프로젝트 디렉터리를 루트로 `knowledge-local` MCP 서버가 등록되고 훅이
활성화됩니다. 스킬을 부르거나 지식 워크스페이스 안의 Markdown을 고치기 전까진 아무것도
실행되지 않습니다.

## 어떤 스킬을 쓰나

| 하고 싶은 것 | 스킬 |
|---|---|
| 자료 하나로 처음부터 끝까지 다 만들기 | `knowledge-workflow` |
| 코드/문서를 링크 걸린 Markdown 볼트 + 룩업 카탈로그로 | `knowledge-base-builder` |
| 클래스명, 관계 의미, 통제 어휘를 먼저 합의 | `ontology-builder` |
| 엔티티·관계를 그래프용 JSONL로 추출 | `knowledge-graph-builder` |
| 그래프를 클릭 가능한 오프라인 HTML로 | `render-graph-view` |
| 벡터 스토어용 청크·메타데이터·평가 질의 준비 | `rag-corpus-builder` |
| 로컬 SQLite 인덱스 빌드/갱신 + 점수 측정 | `sqlite-index-builder` |
| 질문하고 인용·커버리지 등급 달린 답 받기 | `knowledge-query` |

## 스킬

### `knowledge-workflow`

진입점입니다. 자료를 그래프 탐색하듯 읽고 — 시드 소스, 인접 개념, 의존성 — 나머지 스킬을
순서대로 몹니다: 인테이크 → 볼트 → 온톨로지 → 그래프 → RAG → 질의 표면. 산출물 하나가
아니라 "이거 지식화해줘"일 때 씁니다.

```
이 레포를 질의 가능한 지식 시스템으로 만들어줘. 독자는 신규 백엔드 엔지니어고,
온보딩과 영향 분석에 최적화해줘.
```

기본 레이아웃(`knowledge-system/`):

```text
knowledge-system/
  index.md  vault-plan.md  glossary.md  open-questions.md
  notes/  mocs/
  _knowledge/   catalog.jsonl  questions.jsonl  question-results.jsonl  coverage.md
  _ontology/    ontology.md  ontology.yml  mapping.md
  _graph/       schema.md  nodes.jsonl  edges.jsonl  question-reachability.jsonl
  _rag/         chunks.jsonl  sources.csv  eval-queries.jsonl
```

### `knowledge-workflow`

전체 구축과 검색 개선 루프의 진입점. 아래 스킬들을 순서대로 라우팅하고, 수리 루프를
**측정 라운드**로 바꿉니다 — 첫 수정 전에 질문 세트를 분할하고, 측정 1회당 변경 1건,
코퍼스 수정은 회귀 시 되돌리고, 편집거리가 떨어질 때가 아니라 **홀드아웃이 멈출 때**
종료합니다.

### `knowledge-base-builder`

링크 걸린 Markdown 볼트를 만듭니다. 노트 하나는 지속적인 **주장(claim)** 하나 — 개념, 코드
모듈, 결정, 워크플로, 또는 대상들 사이의 *관계*. 원자 단위는 개체가 아니라 주장이라서
"A와 B는 X에서 다르다"는 양쪽 근거를 갖춘 1급 노트가 되지, A와 B로 쪼개져 사라지지 않습니다.

```
src/랑 docs/를 Obsidian 스타일 볼트로 만들어줘. 운영자는 화면명으로 찾고 엔지니어는
매퍼 id로 찾는데, 둘 다 같은 노트에 도착해야 해.
```

노트 외 산출물:

- `_knowledge/catalog.jsonl` — 노트당 레코드 하나: id, path, title, `aliases`, `user_terms`
  (운영자/UI 어휘), `source_symbols`(코드·statement·스키마 식별자), `entities`.
- `_knowledge/questions.jsonl` — 실제 조회 작업에서 뽑은 컴피턴시 질문. 각 질문은 답에 필요한
  노트 id를 명시.
- `_knowledge/question-results.jsonl` + `coverage.md` — 모든 질문을 `complete` / `partial` /
  `unanswerable`로 채점. 하나라도 complete가 아니면 빌드는 **미완**.

완료 게이트:

```bash
node knowledge/scripts/validate-knowledge.mjs --root knowledge-system --require-answerability
```

검증기는 응답 가능성 옆에 **인용 정밀도**도 같이 찍습니다:

```text
Citations: recall 3/3; precision 3/4; off-key 1; full 1/1
```

응답 가능성은 필요한 노트를 인용했는지만 셉니다. 그래서 답이 노트를 더 많이 인용하게 만드는
변경은 무조건 이깁니다. 정밀도 — 인용한 것 중 실제로 필요했던 근거의 비율 — 이 나머지 절반이고,
노이즈로 산 recall이 이 쌍에서 드러납니다. `partial` 결과도 채점하므로 실패한 답이 얼마나
근접했는지가 남습니다. 정밀도는 **보고만 하고 게이트로 걸지 않습니다**: 정답지 밖 인용은
대개 정당한 보조 근거이고, 여기에 게이트를 걸면 답은 더 잘 인용하는 대신 덜 인용하게 됩니다.

### `ontology-builder`

볼트·그래프·RAG 층이 공유할 클래스, 관계 타입, 속성, 제약, 통제 어휘를 정의합니다. 오래
갈 코퍼스나 도메인이 여럿인 코퍼스라면 `knowledge-graph-builder` 전에 쓰세요.
`Service DEPENDS_ON Database`가 어디서나 한 가지 뜻이 되도록.

```
그래프 뽑기 전에 이 WMS 코드베이스 온톨로지 설계해줘. 소유권, 의존성,
화면→쿼리 추적성이 필요해.
```

### `knowledge-graph-builder`

소스 근거가 있는 노드·엣지를 추출합니다. 관계명은 구체적이고 방향이 있으며(`CALLS`,
`QUERIES`, `SUPERSEDES` — `RELATED_TO` 아님), 자명하지 않은 엣지마다 `source_ref`가 붙고,
추론 엣지는 그렇게 표시됩니다. 앵커 공유나 동시 출현은 관계를 *후보로 올릴* 순 있어도
확정하지 못합니다.

```
볼트에서 nodes.jsonl / edges.jsonl 만들어줘. 비교 질문엔 graph_check 달고
각각 2홉 안에 도달 가능한지 증명해줘.
```

관계 중심 컴피턴시 질문은 `_graph/question-reachability.jsonl` 레코드를 받습니다. 도달
불가 질문은 고아 노드와 같은 등급의 그래프 결함입니다.

### `render-graph-view`

`_graph/nodes.jsonl` + `edges.jsonl`을 자체 완결 HTML 한 파일로 렌더링합니다 — 캔버스,
검색, 타입 필터, 상세 패널. CDN·서버 없이 오프라인에서 동작합니다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/render-graph-view/scripts/render-graph-view.mjs" \
  --root knowledge-system --title "WMS 지식 그래프"
```

줌아웃하면 노드가 한 덩어리로 뭉치지 않고 더 넓게 퍼집니다(시맨틱 줌). 노드 위치는 점 크기보다
느리게 축소되고, 엣지는 옅어지며, 라벨은 허브만 남습니다.

끝점이 없는 엣지는 빠지되 **보고됩니다**. 숨기지 않습니다.

### `rag-corpus-builder`

볼트를 메타데이터·인용이 전파된 검색용 청크로 바꾸고 `eval-queries.jsonl`을 함께 냅니다.
의미 있는 제목이 청크 경계로 우선되고, `chunks.jsonl` + `sources.csv`가 정본 코퍼스이며 벡터
DB는 그 아래의 파생 인덱스입니다.

```
pgvector용으로 볼트에서 _rag/ 준비해줘. 재색인해도 인용이 살아있게 노트 id는 고정.
```

### `sqlite-index-builder`

카탈로그 기반 Markdown, RAG 청크, 그래프 JSONL로 `.knowledge/knowledge.sqlite`를 만듭니다.
DB는 일회용 로컬 상태 — Git에는 Markdown과 JSONL만 둡니다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" index --root knowledge-system
node "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" status --root knowledge-system
node "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" eval --root knowledge-system --k 10
```

`eval`은 볼트 자신의 `_knowledge/questions.jsonl`로 검색을 채점해 질문별 순위와 `mrr`,
`recall_at_k`를 냅니다. 인덱스를 다시 만들 때마다 돌리세요. 필수 노트가 top-*k*에 없으면 그건
검색 결함이지 깨끗한 빌드가 아닙니다.

놓친 질문에는 복구 루프가 붙습니다. `repair_targets`는 회수되지 않은 노트를 그것이 막고 있는
질문 수로 정렬하고, 각 결함을 `missing-note`(추출 과제), `no-lookup-vocabulary`(별칭·사용자
용어·소스 심볼이 아예 없음), `ranking`(어휘는 있으나 다른 것이 앞선다)으로 분류합니다. 복구가
스스로를 채점하지 않도록 두 가지 장치가 있습니다. `--split dev|holdout`은 질문의 3분의 1을
남겨둡니다 — 버킷은 질문 id에서 파생되므로 실행마다 동일하고, 어휘를 고치는 도중에 질문이 다른
쪽으로 흘러갈 수 없습니다. `--baseline before.json`은 질문 단위로 비교해, 세 질문을 올리고 한
질문을 떨어뜨린 실행을 평균 상승이 아니라 `verdict: regressed`로 보고합니다. 어휘는 반드시 원본
자료에 실재해야 합니다. 질문 세트에서 복사해 온 용어는 그 질문의 회수를 보장할 뿐 아무것도
측정하지 않습니다.

```json
{ "total": 5, "hits": 5, "recall_at_k": 1, "mrr": 1,
  "questions": [{ "question_id": "stock-table-differences", "first_rank": 1, "hit": true }] }
```

### `knowledge-query`

위의 모든 자산 — SQLite 인덱스, 카탈로그, 볼트, 그래프, RAG — 위에서 질문에 답하며, 항상
커버리지 등급으로 시작합니다:

```markdown
Coverage: partial

수불부와 변동표 모두 버킷 단위로 재고를 분해하지만 축이 다르다 …

Evidence:
- notes/stock/stock-ledger.md -> src/mapper.xml#getStockGoodsListVer2
- notes/stock/stock-change.md -> src/mapper.xml#getStockChangeGridVer2

Missing knowledge:
- 두 출고 모수(rel_stats='CN' 유무)를 대조하는 관계 노트.
```

`complete`는 모든 핵심 부분에 직접 근거가 있다는 뜻입니다. `partial`과 `unanswerable`은
정확히 무엇이 빠졌는지를 지목해서, 그 공백이 그럴듯한 오답으로 조용히 묻히는 대신 다음
추출 작업이 되게 합니다.

## 로컬 SQLite + MCP

`knowledge-local` MCP 서버가 제공하는 도구:

| 도구 | 용도 |
|---|---|
| `knowledge_status` | 인덱스 존재·신선도·건수·임베딩 설정 |
| `knowledge_index` | Markdown·JSONL에서 인덱스 재빌드 |
| `knowledge_search` | 소스 참조·진단 필드가 붙은 하이브리드 검색 |
| `knowledge_get` | 안정 id로 전체 레코드 조회 |
| `knowledge_neighbors` | 노드의 직접 관계 조회 |

### 랭킹 방식

검색은 **순위 융합, lexical 우선**입니다:

1. FTS5 테이블을 컬럼별로 — `title`, `terms`(별칭·운영자 용어·소스 심볼), `body` — 따로
   질의하고 세 순위 리스트를 융합합니다. 노트가 아무리 길어도 제목·별칭 적중이 본문 스침을
   이깁니다.
2. 정확 토큰 인덱스(`unicode61`)와 trigram 인덱스가 한국어 굴절을 처리합니다("재시도"로
   "재시도한"을 찾음).
3. 질의가 관계 노트의 선언된 `participants` 중 둘 이상과 매칭되면 그 관계 노트를 승격합니다.
   선언된 참여자만, 동시 출현은 근거가 아닙니다. 역방향도 성립합니다. 관계 노트가 상위에 들었는데
   선언된 참가자는 회수되지 않는다면, 그 참가자들을 결과 창 **끝**에 붙입니다. 비교형 질문은
   대개 대조 자체의 언어로 표현되기 때문에, 이게 없으면 대조 노트만 회수되고 정작 답에 필요한
   각 변의 근거가 빠집니다. 다른 종류의 질문과 맞바꾸지 않으려면 조건이 셋입니다.
   - 지명은 어휘 순위가 아니라 **융합 후 순위**에서 읽습니다. 대조 노트는 자기 키워드가 아니라
     참가자를 통해 상위로 올라오는 경우가 많아서, 어휘 순위로 판정하면 제자리를 얻어낸 노트가
     오히려 자격을 잃습니다.
   - 승격이 사는 건 **회수 가능성이지 순위가 아닙니다**. 각 변은 상위가 아니라 마지막 슬롯을
     가져가므로 다른 질의의 첫 정답이 밀리지 않습니다. 상위로 올렸을 때를 실제 볼트에서
     측정했습니다 — 비교형은 올랐지만 MRR이 떨어지고 잘 되던 질문 5건이 깨졌습니다.
   - 창 경계는 한 번 읽는 게 아니라 **풀어야 합니다**. 뒤에 붙는 만큼 경계가 당겨지므로 10위
     창의 9위 형제는 형제 둘이 붙는 순간 회수 대상에서 빠집니다. 그 형제도 같이 올려 자기
     형제에게 밀려나지 않게 합니다. 승격은 창의 절반을 넘지 못합니다.

   스스로 회수될 변은 자리를 그대로 둡니다. 결과마다 `relation_promotion`이 방향을 알려주고,
   `relation_participant_promotions`가 스스로는 못 돌아왔을 변의 수를 셉니다.
   `relation_participant_evicted_ids`는 자리를 내주고 창 밖으로 나간 노트를 이름으로 찍어,
   「형제 노트가 밀려났다」가 추측이 아니라 측정이 되게 합니다.
4. 결과는 기본적으로 노트당 1건으로 묶입니다(`group: none`이면 청크 전부). 청크가 많은
   노트 하나가 형제 노트를 top-*k*에서 밀어내지 못합니다. `domain`·`docType`·`section`·
   `pathPrefix` 필터와 질의어 없는 `list` 커맨드로 SQL 없이 범위 조회가 됩니다.
5. 기본 `hash` 임베딩은 의존성 없는 어휘 특징 해시이지 의미 모델이 **아닙니다**. lexical
   매칭이 하나라도 있으면 랭킹에 관여하지 않고, 아무것도 안 걸릴 때 폴백만 정렬합니다.
   결과에 `embedding_quality: lexical-baseline`이 찍혀 의미 검색으로 오해할 일이 없습니다.
6. 실제 임베딩 제공자를 붙이면 융합 비율은 `semantic 0.7 / lexical 0.3`이며, 이 값은 측정된
   상수가 **아니라 출발점**입니다. 의미 가중치는 lexical로는 닿지 못하는 바꿔 말한 질문과
   운영자 구어체를 잡아내지만, 화면 라벨을 그대로 인용한 질문에서는 집니다 — 의미 유사도가
   정확한 용어 일치를 희석합니다. `--lexical-weight`로 `search`·`eval`에서 덮어쓸 수 있고,
   `eval`은 실행에 쓴 비율을 `fusion_weights`에 기록하므로 저장된 기준선과 대조해 스윕 결과를
   나중에 되읽을 수 있습니다. `eval --sweep 0.3,0.4,0.5`는 한 번에 모든 비율을 채점합니다 —
   질의 벡터는 비율과 무관하므로 추가 지점은 임베딩이 아니라 SQL 비용입니다. 비율마다 첫
   비율 대비 **질문별 개선·회귀 목록**이 나오고, 승자를 기준점과 구분할 수 없으면
   `decisive: false`로 표시합니다.
7. 비대칭 검색용으로 학습된 임베딩 모델은 질문과 저장된 본문을 다르게 인코딩하는데, Ollama
   `/api/embed`는 그 지시문을 대신 붙여주지 않습니다. `embeddinggemma`는 문서를
   `title: … | text: …`, 질의를 `task: search result | query: …` 형태로 임베딩합니다. 프롬프트
   id는 색인 메타데이터에 기록되고 `embedding_prompt`로 보고되므로, 질의는 자기 문서가 쓴
   방식으로만 접두됩니다 — 이전에 만든 색인은 재색인 전까지 접두 없이 그대로 동작합니다.
   모르는 모델에는 추측한 프롬프트를 붙이지 않습니다.
8. 모델 컨텍스트보다 긴 문서는 앞부분만 색인되고 나머지는 의미 검색에서 사라집니다 — 전문
   검색으로는 잡히는데 의미 검색으로만 안 잡히는 노트가 됩니다. 예산을 넘는 문서는 **겹치는
   윈도우**로 나눠 임베딩한 뒤 평균 풀링해 벡터 하나로 합칩니다. 긴 노트도 결과 1건으로
   남으니 이후 단계는 그대로입니다. 예산 단위는 토큰이 아니라 문자입니다(`embeddinggemma`:
   1800) — 토크나이저를 로컬에서 쓸 수 없기 때문입니다. `--embed-chars`로 덮어쓸 수 있고,
   빌드 결과에 `embedding_context_chars`와 `documents_windowed`가 보고됩니다. 창 크기를
   모르는 모델은 제한 없이 둡니다.
9. 선택적 cross-encoder **리랭커**가 결과 창을 만들기 전에 후보 상위 목록을 재정렬합니다.
   승격은 재정렬된 순서 위에서 회수 가능성을 판정하므로 독자가 보는 순서 기준이 유지됩니다.
   부착 방식은 Ollama와 동일합니다 — `--reranker-url` / `--reranker-model`, 설치 없음, 필수
   아님. llama.cpp와 text-embeddings-inference가 모두 제공하는 Cohere/Jina `/v1/rerank` 형식을
   쓰고, 엔드포인트가 실패하면 융합 순서로 돌아가며 `rerank_error`를 남깁니다. 상한은 미리
   잴 수 있습니다 — 리랭커는 `recall@50 − recall@10`을 넘을 수 없습니다.

모든 검색 결과에 진단 필드가 붙습니다 — `lexical_candidates`, `lexical_word_matches`,
`lexical_trigram_matches`, `lexical_matches_returned`, `relation_promotions`, `relation_participant_promotions`, `distinct_notes` — 그래서 랭킹
실패가 빈 볼트처럼 보이지 않고 눈에 띕니다.

### 재빌드

`index`는 **항상 전체를 다시 만들되**, 임베딩할 텍스트(프롬프트 접두 포함)가 기존 색인과
바이트 단위로 같은 문서는 저장된 벡터를 재사용합니다. 비싼 쪽만 증분이고 정확성 쪽은
아닙니다 — 노트 3개를 고치면 3개만 임베딩하지만, 삭제·이름 변경된 노트가 잔존 행으로
남는 일은 여전히 불가능합니다. 부분 재색인이 갖는 실패 모드를 이 방식은 갖지 않습니다.
빌드 결과에 `embeddings_reused`·`embeddings_computed`가 찍히고, 제공자·모델·프롬프트
템플릿·스키마 버전이 다르면 캐시는 거부됩니다. `--no-reuse-embeddings`로 강제 냉시작.

### 런타임

Node 24+(플래그 없는 `node:sqlite` + FTS5). Node 22.5–23은 `--experimental-sqlite`가
필요하고 일부 22.x 빌드엔 FTS5가 없습니다. 동봉된 Docker 이미지가 확실한 경로입니다:

```bash
docker compose -f knowledge/compose.yaml run --rm knowledge-index
```

## 로드맵

[ROADMAP.md](ROADMAP.md) — 무엇을 측정 중이고, 무엇이 대기 중이며, 무엇을 의도적으로
하지 않는지. 고치기 쉬운 순서가 아니라 측정된 레버 크기 순입니다.

## 훅

`hooks/knowledge-delta-check.mjs`는 `Write`/`Edit` 뒤에 돌며, 바뀐 Markdown이 기존 지식
워크스페이스에 속할 때만 동작합니다. 단일 노트 카탈로그 upsert를 큐에 넣고, 컴피턴시
결과가 있으면 영향받은 질문의 응답 가능성 재검사도 큐에 넣습니다. 편집을 막지 않고, 전체
재색인을 유발하지 않습니다.

## 실전 사례

창고관리 코드베이스에서 만든 583노트 볼트가 구조 검사를 전부 통과했습니다 — 메타데이터,
출처, 링크 해석률 99 %. 그런데 "재고 수불부 / 현황표 / 변동표 차이가 뭔가?"에 답하지
못했습니다. 답은 세 노트 *사이에* 있었지 어느 노트 안에도 없었습니다. 이 실패가 플러그인의
형태를 만들었습니다:

- 양쪽 근거를 갖춘 관계 노트 (`knowledge-base-builder`)
- 컴피턴시 질문을 강제 완료 게이트로 (`validate-knowledge.mjs`)
- 화면명이 매퍼 id에 닿도록 하는 `user_terms` / `source_symbols` 브리지 (`catalog.jsonl`)
- 검색 변경을 감이 아니라 `mrr`로 증명하는 `eval` (`sqlite-index-builder`)
