# Knowledge Plugin — 이론적 배경

이 플러그인의 스킬 규칙과 `sqlite-knowledge.mjs` 설계가 기대고 있는 이론을 한곳에 모은 문서입니다.
각 절은 **이론 → 원 출처 → 이 플러그인에서 어떻게 쓰는지 → 이론과 다르게 간 지점**의 순서로 씁니다.
측정 수치는 [ROADMAP.md](../ROADMAP.md)와 README `How ranking works`에서 옮긴 것이고, 이 문서가 새로 측정한 것은 없습니다.

작성 2026-09-23, v1.19.0 기준. §8은 이 문서를 기준으로 구현을 적대적으로 검증한 결과입니다.

---

## 1. 지식 단위와 볼트 구조

### 1.1 원자적 노트 — 단위는 엔티티가 아니라 주장

- **이론**: 노트 하나는 하나의 개념만 다뤄야 재사용·링크가 쉽다. 노트가 넓으면 그 안의 한 개념에 대한
  새 발상을 알아채지 못하고, 그 노트로 향하는 링크의 의미도 흐려진다. 소프트웨어의 관심사 분리와 같은 논리.
  Zettelkasten 전통과 Matuschak의 evergreen notes("atomic", "concept-oriented")가 대표적.
- **출처**: Andy Matuschak, [Evergreen notes should be atomic](https://notes.andymatuschak.org/zNUaiGAXp21eorsER1Jm9yU).
- **적용**: `knowledge-base-builder`의 "Treat the claim, not the entity, as the atomic unit". 노트 유형
  (`concept`, `code-module`, `decision`, `workflow`, `relation`, `moc`)은 모두 한 주장을 담는 모양.
- **다르게 간 지점**: 원자성의 단위를 *개념*이 아니라 *주장(claim)*으로 옮겼습니다. "A와 B는 X에서 다르다"는
  A 노트에도 B 노트에도 속하지 않으므로, 개념 단위로 쪼개면 사라집니다. 583노트 WMS 볼트가 구조 검사를 전부
  통과하고도 "재고 수불부·현황표·변동표 차이"에 답하지 못한 사례(README Worked example)가 이 결정의 근거입니다.
  그래서 **relation 노트**(`contrast` / `equivalence` / `sequence`)가 1급 노트이고, 참여자마다 별도 근거
  (`evidence_by_participant`)를 요구합니다.

### 1.2 MOC와 2클릭 도달성

- **이론**: Map of Content는 관련 노트를 묶는 탐색 허브. Zettelkasten의 구조 노트(structure note)와 같은 역할.
- **적용**: "Important notes are reachable from `index.md` or a MOC within two clicks." 단, MOC는 탐색 표면이지
  근거가 아니므로 `required_note_ids`에 넣지 않습니다(answerability-contract §What Belongs).

### 1.3 폴더는 탐색 공간 축소, 메타데이터는 교차 분류

- **이론**: 계층 분류(taxonomy)는 한 축만 표현할 수 있고, 다면 분류(faceted classification)는 나머지 축을 속성으로 표현한다.
- **적용**: 노트마다 정규 경로는 하나(`notes/<domain>/`), 교차 축은 `tags`·`entities`·`aliases`. 소스 트리를 그대로 미러링하지 않음.

---

## 2. 온톨로지

### 2.1 컴피턴시 질문 (Competency Questions)

- **이론**: 온톨로지 요구사항을 "이 온톨로지가 자기 어휘로 답해야 하는 질문"으로 표현하고, 그 질문에 답할 수
  있는지로 온톨로지의 완전성을 평가한다. TOVE(Toronto Virtual Enterprise) 작업에서 제안.
- **출처**: M. Grüninger & M. S. Fox, "The Role of Competency Questions in Enterprise Engineering" (1995);
  "Methodology for the Design and Evaluation of Ontologies", IJCAI'95 Workshop on Basic Ontological Issues in
  Knowledge Sharing. ([Semantic Scholar](https://www.semanticscholar.org/paper/The-Role-of-Competency-Questions-in-Enterprise-Gruninger-Fox/e84846b45565ffc2108246fe20713529e6f63ba7))
- **적용**: 이 플러그인 전체의 중심 개념. `_knowledge/questions.jsonl`이 볼트·그래프·RAG·온톨로지가 공유하는
  단일 질문 집합이고, `validate-knowledge.mjs --require-answerability`가 이를 **완료 게이트**로 씁니다.
- **다르게 간 지점**: 원래 CQ는 온톨로지 *설계·평가* 도구였지만, 여기서는 볼트 전체의 **빌드 게이트**이자
  검색 **평가 셋**(`eval`)으로 확장했습니다. 그래서 평가 셋 오염(§5.3) 문제가 새로 생겼고, dev/holdout 분할로 대응합니다.

### 2.2 클래스/인스턴스 분리와 얕은 계층

- **이론**: 온톨로지 = 클래스(개념) + 슬롯(속성) + 패싯(속성 제약) + 인스턴스. 개발 절차는 도메인·범위 결정 →
  기존 온톨로지 재사용 검토 → 용어 나열 → 클래스와 계층 정의 → 슬롯 정의 → 패싯 정의 → 인스턴스 생성.
- **출처**: N. F. Noy & D. L. McGuinness, [Ontology Development 101: A Guide to Creating Your First Ontology](https://protege.stanford.edu/publications/ontology_development/ontology101.pdf), Stanford KSL, 2001.
- **적용**: `ontology-builder` Process 3–6. "`Service`는 클래스, `Billing API`는 인스턴스". 하위 클래스는
  제약·관계·메타데이터·필터링·질의 동작을 바꿀 때만 추가.
- **보류 중**: ROADMAP "안 하기로 유지 — 온톨로지(E6): eval이 격차를 지목하기 전까지 Later".

### 2.3 관계 의미론 — 방향, 대칭, 역관계, 전이성

- **이론**: 관계는 정의역/치역, 카디널리티, 대칭성, 역관계, 전이성을 명시해야 추론이 일관된다(OWL 속성 특성과 같은 틀).
- **적용**: `DEPENDS_ON`은 영향 분석에는 전이적, 소유권에는 비전이적. 역방향 엣지가 없다는 것만으로 결함이 아님 —
  온톨로지가 대칭이나 materialized inverse를 선언했을 때만 검사.

---

## 3. 지식 그래프

### 3.1 구체적·방향성 있는 관계 타입

- **이론**: 속성 그래프/RDF 모델에서 관계 타입은 질의 가능한 의미 단위. `RELATED_TO` 같은 포괄 타입은 그래프를
  동시출현 행렬로 되돌린다.
- **적용**: `knowledge-graph-builder`의 Weak → Better 표 (`USES` → `CALLS`/`QUERIES`/`IMPORTS` …).
  공유 앵커와 동시출현은 관계를 *지명*할 수는 있어도 *확정*하지 못함. 추론 엣지는 `confidence` + `inference_reason` 필수.

### 3.2 멀티홉 질문과 도달성

- **이론**: 여러 문서에 걸친 근거가 필요한 질문은 두 종류로 나뉜다. *비교(comparison)* 질문은 질문의 단어로
  필요한 사실을 대부분 찾을 수 있지만, *브리지(bridge)* 질문은 먼저 일부를 찾고 그걸로 다음 질의를 만들어야 한다.
- **출처**: Z. Yang et al., [HotpotQA: A Dataset for Diverse, Explainable Multi-hop Question Answering](https://arxiv.org/abs/1809.09600), EMNLP 2018.
- **적용**:
  - 그래프 쪽: `graph_check: true` 질문마다 `_graph/question-reachability.jsonl`에 `max_hops` 이내 타입·근거
    있는 경로를 기록. 도달 불가 = 그래프 결함.
  - 질의 쪽: `knowledge-query`의 "One hop before answering, for questions with sides" — 최상위 후보에서
    `knowledge_neighbors`로 한 홉 확장 후 답변. 측정상 단일노트 질문 0.94 vs 다중출처 0.28/0.69.
- **다르게 간 지점**: 그래프를 *걷지* 않고 **한 홉에서 멈춥니다**. 측정에서 놓친 노트는 정확히 한 홉 거리의
  허브·대조·형제 노트에 몰려 있었고, 그 이상의 탐색은 근거가 없습니다.

### 3.3 GraphRAG와의 관계

- **이론**: LLM으로 엔티티 그래프를 만들고 커뮤니티 요약을 미리 생성해, 코퍼스 전체에 대한 "전역 의미 파악" 질문에 답한다.
- **출처**: D. Edge et al., [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130), 2024.
- **다르게 간 지점**: 이 플러그인은 커뮤니티 요약을 만들지 않습니다. 그래프는 **요약 대상이 아니라 근거 경로**이고,
  대조·비교 같은 "사이에 있는 지식"은 LLM 요약 대신 사람이 검증할 수 있는 relation 노트로 명시합니다.

---

## 4. 검색 (Retrieval)

### 4.1 어휘 검색 — BM25와 FTS5

- **이론**: 확률적 관련성 프레임워크(PRF)에서 유도된 BM25. 필드별 가중을 두는 확장이 BM25F.
- **출처**: S. Robertson & H. Zaragoza, [The Probabilistic Relevance Framework: BM25 and Beyond](https://www.nowpublishers.com/article/Details/INR-019), Foundations and Trends in IR, 2009.
  구현: [SQLite FTS5](https://sqlite.org/fts5.html) — 내장 `bm25()`, `unicode61`·`trigram` 토크나이저(3.34.0+).
- **적용**: FTS5를 **컬럼별**(`title`, `terms`, `body`)로 따로 질의하고 순위 목록을 융합. 제목·별칭 매치가
  본문 언급을 노트 길이와 무관하게 이김.
- **다르게 간 지점**: BM25F처럼 필드 가중을 점수에 섞는 대신, 필드마다 **순위를 따로 내고 RRF로 합칩니다**(§4.3).
  점수 스케일을 맞출 필요가 없어집니다.

### 4.2 부분문자열 매칭 — trigram과 한국어 활용

- **이론**: n-gram(여기서는 3-gram) 색인은 형태소 분석 없이 부분 문자열 매칭을 제공한다.
- **적용**: 정확 토큰 색인(`unicode61`)이 "재시도한"에서 "재시도"를 놓치는 것을 trigram 색인이 회수.
  두 목록은 `0.7 / 0.3` 가중 RRF로 하나의 어휘 순위가 됨(`fuseLexicalRanks`).
- **이론의 빈틈**: trigram은 3자 미만을 못 잡는데, 한국어 핵심 명사(재고·출고·결제)는 2음절입니다. v1.18.0부터
  한글 질의어는 FTS5 **접두어**로 매칭하고, 끝 조사를 뗀 어간을 원형 **옆에** 두 번째 접두어로 더합니다
  (조사는 모호합니다 — 재시도는 `도`로 끝남 — 그래서 대체가 아니라 추가).

### 4.3 순위 융합 — Reciprocal Rank Fusion

- **이론**: 여러 검색 시스템의 순위를 `score(d) = Σ 1 / (k + rank(d))`로 합친다. 점수 정규화 없이 순위만 쓰며,
  Condorcet Fuse, CombMNZ, 개별 learning-to-rank보다 일관되게 좋았다. 원 논문의 k = 60.
- **출처**: G. V. Cormack, C. L. A. Clarke, S. Buettcher, [Reciprocal Rank Fusion outperforms Condorcet and Individual Rank Learning Methods](https://research.google/pubs/reciprocal-rank-fusion-outperforms-condorcet-and-individual-rank-learning-methods/), SIGIR 2009.
- **적용**: `RRF_K = 60`. 세 단계에서 쓰임 — 컬럼별 FTS 순위 융합, 단어/trigram 융합, 어휘/의미 융합.
  후보는 두 목록의 **합집합** 위에서 융합(의미 목록만 순위 매기면 어휘 매치가 올라갈 상한이 생김).
- **다르게 간 지점**:
  - 원래 RRF는 가중치가 없지만 여기서는 **가중 RRF**입니다: 의미/어휘 `0.7 / 0.3` (semantic provider일 때),
    `hash`일 때 `0 / 1`. 이 값은 **측정된 상수가 아니라 출발점**이고 `eval --sweep`으로 검증합니다.
    의미 가중은 바꿔 말한 질문을 이기고, 화면 라벨을 그대로 인용한 질문에서 집니다.
  - relation 노트 승격은 별도 RRF 항(`RELATION_RRF_WEIGHT = 0.35 × lexical weight`)으로 더해지며, 점수를 더하기만
    하므로 강등은 없습니다. 어휘 가중을 곱하지 않던 v1.17까지는 0.7/0.3 분할에서 가산점만으로 최상위 어휘 매치를
    이겼습니다(§8).

### 4.4 밀집 검색 — 바이인코더와 비대칭 임베딩

- **이론**: 질문과 패시지를 각각 인코딩해 내적으로 비교하는 dual-encoder(바이인코더). 오픈 도메인 QA에서
  BM25를 top-20 정확도 9–19%p 앞섬.
- **출처**: V. Karpukhin et al., [Dense Passage Retrieval for Open-Domain Question Answering](https://arxiv.org/abs/2004.04906), EMNLP 2020.
- **비대칭 프롬프트**: 비대칭 검색용으로 학습된 모델은 질의와 문서를 다르게 인코딩한다. EmbeddingGemma는
  질의에 `task: search result | query: `, 문서에 `title: {title|none} | text: `를 붙이도록 문서화되어 있고,
  제목을 넣으면 성능이 오른다. ([EmbeddingGemma model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card))
- **적용**: `--provider ollama --model embeddinggemma`. 인덱스 메타데이터에 `embedding_prompt`를 기록해
  문서가 접두된 방식대로만 질의를 접두. 알 수 없는 모델은 추측 프롬프트 대신 프롬프트 없음.
- **측정**: `hash` → `embeddinggemma`로 hits 43 → 62, recall@10 0.631 → 0.803, MRR 0.558 → 0.791.
  이전 엔진 6개 버전 합보다 큼. 이것이 "가장 큰 레버부터"라는 워크플로 규칙의 근거입니다.

### 4.5 긴 문서 — 겹치는 윈도 + 평균 풀링

- **이론**: 컨텍스트보다 긴 입력은 잘리므로, 겹치는 윈도로 나눠 각각 임베딩한 뒤 평균 풀링해 하나의 벡터로 만든다.
  겹침은 경계에 걸친 구절이 어느 한 윈도 안에서는 온전하도록 하기 위함.
- **적용**: `embeddinggemma` 1800자 예산(토크나이저가 로컬에 없어 문자 단위). `documents_windowed`로 보고.
  이 값이 크면 엔진이 아니라 `rag-corpus-builder` 청크 규칙을 고칩니다.

### 4.6 특징 해싱 — `hash` provider의 정체

- **이론**: 특징을 해시 함수로 고정 차원에 사상하는 hashing trick. 해시 공간에서 내적 왜곡이 작다는 꼬리 확률 경계가 있음.
- **출처**: K. Weinberger et al., [Feature Hashing for Large Scale Multitask Learning](https://arxiv.org/abs/0902.2206), ICML 2009.
- **적용**: 기본 `hash` 임베딩은 의존성 없는 **어휘 특징 해시**이지 의미 모델이 아닙니다. 어휘 매치가 하나라도
  있으면 순위 가중 0, 매치가 없을 때 폴백 순서만 정함. 결과에 `embedding_quality: lexical-baseline`을 찍어
  의미 검색으로 오인되지 않게 함.

### 4.7 리랭킹 — 크로스인코더와 천장

- **이론**: 질의와 후보를 한 입력으로 함께 읽는 크로스인코더는 바이인코더 유사도가 못 가르는 것을 가른다. 대신 느려서 짧은 후보 목록에만 쓴다.
- **출처**: R. Nogueira & K. Cho, [Passage Re-ranking with BERT](https://arxiv.org/abs/1901.04085), 2019.
  실무 근거: Anthropic, [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) (2024) — 임베딩+BM25에 리랭킹을 더해 top-20 검색 실패율 5.7% → 1.9%.
- **적용**: `--reranker-url` / `--reranker-model` / `--rerank-depth 50`, Cohere/Jina `/v1/rerank` 형식.
  **창 구성 전에** 재정렬하므로 relation 승격의 회수 보장이 유지됨. 실패 시 융합 순서로 폴백 + `rerank_error`.
- **천장 원리**: 리랭커는 이미 회수된 것만 재정렬하므로 최대 이득은 **`recall@50 − recall@10`**.
  모델을 받기 전에 같은 인덱스로 `eval --k 10`과 `--k 50`을 돌려 상한을 먼저 잽니다.
  단, relation 참여자는 예외: 리랭커가 relation 노트를 상위 8위로 올리면 참여자가 깊이와 무관하게 창 끝에 붙습니다.

### 4.8 relation 참여자 승격 — 이 플러그인 고유 규칙

외부 이론이 아니라 측정에서 나온 설계입니다. 근거가 되는 관찰만 적습니다.

- 비교 질문은 대조의 언어로 표현되므로 대조 노트만 회수되고 각 면의 근거가 빠진다 → 선언된 `participants`를 창의 **끝**에 추가.
- 승격은 **회수 가능성을 사지 순위를 사지 않는다**. 상위에 넣었더니 비교 답은 올랐지만 MRR이 떨어지고 기존 5문항이 깨졌음.
- 창 경계는 한 번 읽지 않고 **푼다**(추가된 면이 컷오프를 움직임). 승격 상한은 창의 절반(`RELATION_PARTICIPANT_WINDOW_SHARE = 0.5`).
- 동시출현이 아니라 **선언된 참여자만** 승격(§3.1과 같은 원칙).

### 4.9 청크 — 무엇을 검색 단위로 삼을 것인가

청크는 "검색이 돌려주는 가장 작은 단위"입니다. 이론은 다섯 갈래로 정리됩니다.

**(1) 단위가 작을수록 검색은 정확해진다 — 명제(proposition) 단위.**
- **이론**: 문단 대신 "하나의 사실을 담은 자족적 문장(명제)"을 색인 단위로 쓰면 밀집 검색과 하류 QA가 모두
  문단 단위보다 좋아진다. 긴 텍스트는 의미가 한 벡터에 "과압축"된다.
- **출처**: T. Chen et al., [Dense X Retrieval: What Retrieval Granularity Should We Use?](https://arxiv.org/abs/2312.06648), EMNLP 2024.
- **적용**: 이 플러그인의 노트는 이미 *주장 하나*(§1.1)이므로 노트 자체가 명제에 가깝습니다. 청크는 긴 노트를
  "답할 수 있는 한 지점"씩 나누는 보조 단위로 둡니다.

**(2) 작게 찾고 크게 읽는다 — parent-document (small-to-big) 검색.**
- **이론**: 작은 자식 청크로 검색 정밀도를 얻고, 생성에는 그 청크를 포함한 부모 문서/섹션을 넘긴다. 검색
  단위와 생성 문맥의 크기를 분리하는 것.
- **출처**: LangChain·LlamaIndex의 ParentDocumentRetriever / small-to-big 패턴(학술 표준이라기보다 실무 관행).
- **적용**: 이미 구조가 그렇습니다. 청크는 `note_id`로 부모 노트에 묶이고, 검색은 **노트당 1건**으로 묶어
  돌려주며(청크가 창을 독점하지 않게), 답변은 `knowledge_get`으로 **노트 전체**를 엽니다(§6.2 "연 것만 인용").

**(3) 경계를 똑똑하게 찾는 비용은 잘 회수되지 않는다 — 의미 청킹 vs 고정 크기.**
- **이론**: 임베딩 유사도로 경계를 찾는 "의미 청킹"은 문서 검색·근거 검색·답변 생성 세 과제에서 고정 크기
  분할보다 **일관된 이득이 없었다**. 반면 청크 크기는 결과를 크게 바꾼다 — 토큰 단위 재현율/정밀도/IoU로 잰
  비교에서 같은 방법도 200 vs 400 토큰에서 순위가 뒤집힘.
- **출처**: R. Qu, R. Tu, F. Bao, [Is Semantic Chunking Worth the Computational Cost?](https://arxiv.org/abs/2410.13070), Findings of NAACL 2025;
  Chroma, [Evaluating Chunking Strategies for Retrieval](https://www.trychroma.com/research/evaluating-chunking), 2024.
- **적용 (v1.19.0 규칙 변경)**: `rag-corpus-builder`는 원문이 **이미 가진 구조**(제목·함수·단계·조항)에서 자르고,
  임베딩 기반 경계 탐색은 하지 않습니다. 구조가 없으면 겹침 있는 고정 크기. 방법보다 **크기**를 관리합니다 —
  청크 하나 = 답할 수 있는 한 지점, 임베딩 창(1800자) 안쪽. 색인 시 `documents_windowed > 0`이면 청크가 너무 굵다는 신호.

**(4) 잘라낸 조각은 자기가 어디서 왔는지 모른다 — 맥락 복원.**
- **이론**: "매출이 3% 늘었다"라는 청크는 어느 회사·어느 분기인지 모른다. 청크마다 문서 안에서의 위치를 설명하는
  50–100토큰 맥락을 LLM으로 써서 **임베딩과 BM25 색인 양쪽 모두** 앞에 붙이면 top-20 검색 실패율이
  5.7% → 3.7%(임베딩만, −35%) → 2.9%(+BM25, −49%) → 1.9%(+리랭커, −67%). 문서 요약을 모든 청크에 똑같이
  붙이는 방식은 이득이 매우 작았다.
- **출처**: Anthropic, [Introducing Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval), 2024.
- **적용 (v1.19.0)**: 두 층으로 나눴습니다.
  - *결정적 맥락* — 엔진이 자동으로: 청크는 부모 노트의 제목·카탈로그 어휘(`user_terms`·`source_symbols`·aliases…)를
    `terms` 열로 **상속**하고, 자기 제목이 없으면 부모 제목을 임베딩 `title:` 자리에 씁니다. 카탈로그가 이미 가진
    정보라 LLM 호출이 필요 없습니다. 이전에는 청크의 `terms`가 비어 있어서 화면 라벨·잡 심볼로 청크를 찾을 수 없었고,
    청크에 적힌 어휘 필드는 읽고 버려졌습니다.
  - *작성된 맥락* — `rag-corpus-builder`가 청크마다 `context` 문장을 씀: 엔진이 매칭·임베딩 텍스트 앞에 붙입니다.
    "노트가 무엇인지"가 아니라 "이 청크가 노트의 어디·무엇인지"를 씁니다(요약 복붙은 효과가 작다는 관찰 반영).
- **다르게 간 지점**: Anthropic은 맥락 전부를 LLM으로 만들지만, 여기서는 카탈로그가 가진 부분은 결정적으로 상속하고
  LLM에는 카탈로그가 모르는 부분만 맡깁니다. 비용이 줄고, 상속분은 재색인 때마다 같은 결과를 냅니다.

**(5) 먼저 전체를 읽고 나중에 자른다 — late chunking.**
- **이론**: 긴 문맥 임베딩 모델로 문서 전체의 토큰 표현을 먼저 만들고, 청크 경계는 트랜스포머 **뒤**, 평균 풀링
  직전에 적용한다. 각 청크 벡터가 주변 문맥을 품는다.
- **출처**: M. Günther et al., [Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models](https://arxiv.org/abs/2409.04701), 2024.
- **채택 안 함**: 토큰 단위 출력이 필요한데 Ollama `/api/embed`는 풀링된 벡터만 돌려줍니다. 이 플러그인의 긴 노트
  윈도 평균(§4.5)은 이것과 반대 방향 — 윈도를 각각 인코딩한 뒤 합침 — 이라, 윈도 사이 문맥은 공유되지 않습니다.
  윈도마다 문서 프롬프트와 제목을 붙이는 것(v1.18.0)이 현재 쓸 수 있는 근사치입니다.

**평가 쪽 함의.** Chroma의 토큰 단위 IoU는 "필요한 토큰만 가져왔는가"를 재는데, 이 플러그인의 `eval`은 노트 단위
recall/MRR만 봅니다. 청크 크기를 바꾸는 실험에서는 노트 단위 지표가 둔감할 수 있으므로, 인용 정밀도(§5.2)를 함께 봅니다.

---

## 5. 평가와 측정 규율

### 5.1 MRR과 recall@k

- **이론**: MRR = (1/Q) · Σ 1/rankᵢ (첫 정답 순위의 역수 평균, 미회수 0). TREC-8 QA 트랙(1999)의 공식 지표.
- **출처**: E. M. Voorhees, [The TREC-8 Question Answering Track](http://www.lrec-conf.org/proceedings/lrec2000/pdf/26.pdf); [Mean reciprocal rank](https://en.wikipedia.org/wiki/Mean_reciprocal_rank).
- **적용**: `eval`이 질문별 `first_rank`, `hit`, 집계 `mrr`, `recall_at_k`, `mean_distinct_notes`를 보고.
  노트 단위 그룹핑(기본)은 한 노트의 청크가 top-k를 독점해 recall을 깎는 것을 막음.

### 5.2 인용 정밀도/재현율

- **이론**: 정보검색의 precision/recall을 인용에 적용. RAG 평가에서 context precision(회수 근거 중 관련 비율),
  context recall(필요 근거가 들어있는지), faithfulness(답이 근거에 기반하는지)로 나누는 것과 같은 틀.
- **출처**: S. Es et al., [RAGAS: Automated Evaluation of Retrieval Augmented Generation](https://arxiv.org/abs/2309.15217), 2023.
- **적용**: `Citations: recall 3/3; precision 3/4; off-key 1; full 1/1`. recall은 "더 인용하기"만으로 공짜로 오르므로
  precision을 옆에 둠. **보고만 하고 게이트로 걸지 않음** — 게이트로 걸면 답이 더 잘이 아니라 덜 인용하도록 학습됨.

### 5.3 Holdout과 적응적 분석

- **이론**: 분석을 데이터를 본 뒤 적응적으로 고르면, 같은 holdout을 반복 사용하는 순간 그 holdout은 더 이상
  편향 없는 추정치가 아니다(가짜 발견의 흔한 원인).
- **출처**: C. Dwork et al., [The reusable holdout: Preserving validity in adaptive data analysis](https://www.science.org/doi/10.1126/science.aaa9375), Science 349 (2015).
- **적용**: `--split dev|holdout`. holdout은 **첫 수정 전에 한 번 기록하고 손대지 않음**. 수리는 dev에만.
  종료 조건 4 — "dev는 오르는데 holdout이 안 움직이면 멈춘다(과적합)".
- **구현 세부**: 버킷은 질문 id의 FNV-1a 해시 + MurmurHash3 finalizer(avalanche)로 결정 → 실행·머신·순서가
  바뀌어도 분할이 고정되고, 어휘를 고치는 동안 질문이 분할 사이를 떠돌 수 없음. 기본 holdout 비율 0.35.
  finalizer가 없으면 `question-1 … question-94`처럼 끝자리만 다른 id가 한 쪽에 몰립니다.

### 5.4 누수(leakage) — 질문에서 어휘를 베끼지 말 것

- **이론**: 예측 시점에 정당하게 쓸 수 없는 타깃 정보가 학습에 섞이는 것. 데이터 마이닝 10대 실수 중 하나.
  대응은 learn-predict 분리.
- **출처**: S. Kaufman, S. Rosset, C. Perlich, O. Stitelman, [Leakage in Data Mining: Formulation, Detection, and Avoidance](https://dl.acm.org/doi/10.1145/2382577.2382579), ACM TKDD 6(4), 2012.
- **적용**: "Ground every added term in the source material, never in the question." `questions.jsonl`의 문구를
  `user_terms`에 복사하면 그 질문의 회수가 보장되고 아무것도 측정하지 않음. 소스 밖에서 찾을 수 없는 용어는
  어휘가 아니라 누락 노트/누락 소스 신호.

### 5.5 한 번에 하나만 바꾸기, 회귀는 되돌리기

- **원리**: 통제 실험의 기본 — 변경 둘을 한 번에 측정하면 귀속도 되돌리기도 불가능.
- **적용**: `--baseline before.json`이 질문별로 비교해 `improvements` / `regressions` / `verdict`를 냄.
  질문마다 회수한 필수 노트 수(`found_before/after`)도 비교하고, `k`·분할·holdout 비율이 다르면 `incomparable`.
  컴피턴시 셋이 작아 한 문항이 recall을 몇 포인트 움직이므로, 평균 상승이 깨진 문항을 가리기 쉬움 →
  **코퍼스·어휘 수정은 회귀가 하나라도 있으면 되돌림**. 엔진·provider 변경은 모든 질문을 한꺼번에 움직이므로
  순이동과 holdout을 함께 보고 회귀를 이름으로 보고.
- **스윕의 `decisive`**: 승자의 질문별 개선/회귀가 정확 이항 **부호 검정**(p < 0.05)을 통과해야 true.
  v1.17까지는 hits·MRR이 조금이라도 다르면 true였습니다. 승자를 같은 질문으로 고르므로 여전히 holdout 확인이 필요. 동점을 승자로 부르는 것이
  추측이 기본값이 되는 경로.

### 5.6 Answerability와 커버리지 보정

- **이론**: 모델이 표시하는 확신과 실제 정확도가 일치하는 정도가 보정(calibration). 현대 신경망은 오히려 과신 쪽으로 보정이 나쁘다.
- **출처**: C. Guo et al., [On Calibration of Modern Neural Networks](https://arxiv.org/abs/1706.04599), ICML 2017.
- **적용**: `Coverage: complete`가 선언 69/80회 대비 실제 22/38회 — 보정이 안 된 확신. 그래서 `complete`를
  확신이 아니라 **부분 대응표**로 판정: 질문을 부분으로 나누고 각 부분에 *연(open)* 노트를 대응, 하나라도
  스니펫·추론·없음이면 `partial`.

---

## 6. 생성층과 근거

### 6.1 RAG — 파라메트릭 + 비파라메트릭 메모리

- **이론**: 사전학습 생성 모델(파라메트릭)과 검색 가능한 외부 색인(비파라메트릭)을 결합하면 지식 집약 과제에서
  더 구체적이고 사실적인 출력이 나온다.
- **출처**: P. Lewis et al., [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401), NeurIPS 2020.
- **적용**: `chunks.jsonl` + `sources.csv`가 정본 코퍼스이고 벡터 DB는 하류 색인. SQLite도 버릴 수 있는 파생 상태.
- **ROADMAP Phase 4 조건**: 검색 recall 0.8+ 전에는 생성층을 시작하지 않음 — 근거가 없으면 생성층은 지어냄.

### 6.2 "연 것만 인용" — 스니펫은 근거가 아니다

- **관련 이론**: 모델은 긴 컨텍스트에서 관련 정보의 위치에 따라 성능이 크게 달라지고, 중간에 있는 정보를 잘 못 쓴다.
  출처: N. F. Liu et al., [Lost in the Middle: How Language Models Use Long Contexts](https://aclanthology.org/2024.tacl-1.9/), TACL 2024.
- **적용**: 검색 결과는 후보이지 근거가 아님. 인용할 노트는 전부 `knowledge_get`으로 연다. 측정상 노트를 하나도
  안 연 답은 필수 노트를 14% 인용, 4개 이상 연 답은 93%.
- **측정이 옮긴 병목**: 두 모델 모두 94문항 중 0건 인용은 1건뿐 — 회수는 더 이상 병목이 아니고, 가져온 것을
  생성층이 흘립니다(노트 단위 인용 0.476 / 0.644). ROADMAP 2026-08-31 측정 참조.

---

## 7. 시각화

### 7.1 힘 기반 배치

- **이론**: 노드를 입자, 엣지를 스프링으로 보고 인력·척력 평형으로 배치. 균일한 엣지 길이를 지향.
- **출처**: T. Fruchterman & E. Reingold, [Graph drawing by force-directed placement](https://onlinelibrary.wiley.com/doi/10.1002/spe.4380211102), Software: Practice and Experience 21(11), 1991.
- **적용**: `render-graph-view`의 force-directed 캔버스, 차수에 비례하되 범위를 제한한 노드 크기.

### 7.2 의미적 줌 (semantic zoom)

- **이론**: 줌 배율에 따라 크기만이 아니라 **표현 자체**가 바뀐다 — 멀리서는 단순화, 가까이서는 세부.
- **출처**: K. Perlin & D. Fox, [Pad: An Alternative Approach to the Computer Interface](https://mrl.cs.nyu.edu/~perlin/pad-siggraph.pdf), SIGGRAPH 1993.
- **적용**: 줌아웃 시 노드 위치가 노드 점보다 천천히 줄어 그래프가 펼쳐지고, 엣지는 흐려지며, 라벨은 허브만 남음.

---

## 8. 적대적 검증 결과 (2026-09-23, v1.17.1 → v1.18.0)

이 문서의 이론을 기준으로 구현을 반증하려 한 결과입니다. 7노트 probe 볼트(`hash` provider)로 재현했고,
의미 가중은 `--lexical-weight 0.3`으로 모사했습니다(로컬 Ollama 없음). 실제 94문항 볼트 재측정은 하지 않았습니다.

| # | 결함 | 이론 | 조치 |
|---|---|---|---|
| 1 | 2음절 한국어 명사 + 조사 미매칭 ("재고" ↛ "재고가", "재고를 확인" ↛ "재고 수불부") | §4.2 | 수정: 한글 접두어 + 조사 뗀 어간 추가 |
| 2 | 점수 0인 relation 노트가 상위 8위에 동률로 들어와 무관한 질의에 참여자를 붙임 | §4.8 | 수정: 원천은 score > 0만 |
| 3 | 0.7/0.3 분할에서 어휘 매치 0인 relation 노트가 승격 가산점만으로 1위 | §4.3 | 수정: 가산점 × lexical weight |
| 4 | 긴 노트의 윈도 2+에 문서 프롬프트·제목 누락 | §4.4–4.5 | 수정: 윈도마다 wrap |
| 5 | 다중 노트 질문이 필수 노트를 잃어도 `unchanged` | §5.5 | 수정: `found_before/after` 비교 |
| 6 | 기준선 조건(k·split·ratio·reranker·embedding) 미검사 | §5.3 | 수정: `incomparable` + `differences` |
| 7 | `decisive` = 차이가 조금이라도 있으면 true | §5.3 | 수정: 부호 검정 p < 0.05 |
| 8 | 리랭커 천장이 relation 승격 때문에 엄밀한 상한이 아님 | §4.7 | 문서 정정 |
| 9 | 검증기가 `required_user_terms`의 출처를 묻지 않음 — 질문 문구를 카탈로그로 끌어들임 | §5.4 | 계약 문서에 규칙 추가 (기계 검사는 없음) |
| 10 | holdout "3분의 1" 표기 vs 기본 0.35; `question-1…94`는 47%가 holdout | §5.3 | 문서 정정 (분할 로직은 대표본에서 0.35로 수렴) |

남은 한계: `hash` 인덱스에서도 `--lexical-weight`가 허용되어 해시 잡음에 의미 가중이 붙음, 질의 토큰 24개 상한,
answer hash가 본문이 아니라 파일 전체(더 엄격한 쪽이라 무해), holdout이 `kind`로 층화되지 않음,
Dwork식 재사용 holdout 메커니즘은 없고 "한 번만 본다"는 절차 규칙에 의존.

---

## 참고문헌

| # | 출처 | 쓰인 곳 |
|---|---|---|
| 1 | Matuschak, *Evergreen notes should be atomic* | §1.1 |
| 2 | Grüninger & Fox 1995, competency questions | §2.1 |
| 3 | Noy & McGuinness 2001, *Ontology Development 101* | §2.2 |
| 4 | Yang et al. 2018, *HotpotQA* | §3.2 |
| 5 | Edge et al. 2024, *GraphRAG* | §3.3 |
| 6 | Robertson & Zaragoza 2009, *BM25 and Beyond*; SQLite FTS5 | §4.1–4.2 |
| 7 | Cormack, Clarke, Buettcher 2009, *RRF* | §4.3 |
| 8 | Karpukhin et al. 2020, *DPR*; EmbeddingGemma model card | §4.4 |
| 9 | Weinberger et al. 2009, *Feature Hashing* | §4.6 |
| 10 | Nogueira & Cho 2019, *Passage Re-ranking with BERT*; Anthropic 2024, *Contextual Retrieval* | §4.7 |
| 11 | Voorhees 1999, TREC-8 QA (MRR) | §5.1 |
| 12 | Es et al. 2023, *RAGAS* | §5.2 |
| 13 | Dwork et al. 2015, *Reusable holdout* | §5.3 |
| 14 | Kaufman et al. 2012, *Leakage in Data Mining* | §5.4 |
| 15 | Guo et al. 2017, *On Calibration* | §5.6 |
| 16 | Lewis et al. 2020, *RAG* | §6.1 |
| 17 | Liu et al. 2024, *Lost in the Middle* | §6.2 |
| 18 | Fruchterman & Reingold 1991 | §7.1 |
| 19 | Perlin & Fox 1993, *Pad* | §7.2 |
| 20 | Chen et al. 2024, *Dense X Retrieval* | §4.9 |
| 21 | Qu, Tu, Bao 2025, *Is Semantic Chunking Worth the Computational Cost?*; Chroma 2024, *Evaluating Chunking Strategies* | §4.9 |
| 22 | Anthropic 2024, *Contextual Retrieval* | §4.7, §4.9 |
| 23 | Günther et al. 2024, *Late Chunking* | §4.9 |
