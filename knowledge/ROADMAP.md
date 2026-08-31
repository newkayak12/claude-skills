# Knowledge Plugin — Retrieval Roadmap

작성 2026-08-31, v1.11.0 기준. 순서의 근거는 이 세션에서 측정된 레버 크기입니다:
임베딩 교체 +19 hits > 엔진 변경 +24 (6개 버전 합) > 코퍼스/어휘 작업 0 (3회 시도).
로드맵도 그 순서를 따르고, 각 Phase는 앞 Phase의 측정 게이트 뒤에 섭니다.

측정 이력: hits 19 (v1.5.1) → 43 (v1.8.0, hash) → 62 (ollama/embeddinggemma), 94문항,
recall@10 0.803, MRR 0.791. 상세는 README `How ranking works`와 커밋 메시지 참조.

---

## Phase 0 — 걸려 있는 측정 (작업이 아니라 판정)

| 항목 | 판정 기준 |
|---|---|
| v1.11 재색인 (비대칭 프롬프트 + 컨텍스트 윈도잉) | 62 대비 hits·MRR, `documents_windowed` 값 |
| `--lexical-weight` 스윕 0.3 / 0.4 / 0.5 | 라벨 인용 회귀가 풀리는 비율 vs 전체 손해 |
| `repair_targets` 재분류 | 미회수 32건이 `missing-note` / `ranking` / `no-lookup-vocabulary` 어디에 몰리는지 |

**분기**: 미회수가 `missing-note`에 몰리면 다음 라운드는 코퍼스 추출,
`ranking`에 몰리면 Phase 1.

## Phase 1 — 검색 엔진 잔여 레버 (측정이 지목한 것만)

1. **형제 노트 이탈** — `RELATION_PARTICIPANT_WINDOW_SHARE 0.5`가 semantic 후보 유입
   이후에도 맞는 값인지. ~~안 쓴 예약을 일반 후보에게 반환~~ — 코드를 확인한 결과 이
   전제는 틀렸습니다. `WINDOW_SHARE`는 예약이 아니라 **실제 승격 건수의 상한**이라
   미사용 슬롯이 생기지 않습니다. 대신 v1.12.0이 `relation_participant_evicted_ids`로
   **승격 때문에 창 밖으로 밀려난 노트를 이름으로** 찍습니다. 형제 이탈이 승격 탓인지
   semantic 후보 유입 탓인지는 이 진단으로 판정합니다.
2. **스윕 결과를 기본값으로 승격** — 0.7/0.3보다 나은 지점이 나오면 `fusionWeights`
   기본값 교체 + 근거 주석.
3. **청크 굵기** — `documents_windowed`가 크면 `rag-corpus-builder` 쪽 청크 분할 규칙
   수정 (엔진이 아니라 코퍼스 생성 규칙).

## Phase 2 — 리랭커 (사용자 부착, 선택) — 계약 완료 (v1.13.0)

top-50을 cross-encoder로 재정렬. `--provider ollama`와 같은 패턴 — **기본은 없음,
있으면 사용**. `bge-reranker-v2-m3` 같은 한국어 지원 모델이 후보.

측정 게이트를 "Phase 0/1 이후"로 뒀던 건 과했습니다. 계약 자체는 **부착 안 하면
동작에 영향이 0**이라 측정 전에 만들어도 손해가 없고, 실제로 필요한 게이트는 훨씬
싼 숫자입니다: 리랭커는 이미 회수된 것만 재정렬하므로 **상한이
`recall@50 − recall@10`**입니다. `eval --k 10`과 `eval --k 50`을 같은 색인에 돌리면
모델을 받기 전에 천장을 알 수 있습니다. k=50에서도 없는 노트는 랭킹 문제가 아니라
회수/카탈로그 문제입니다.

## Phase 3 — 루프 닫기 (E3·E5 잔여분)

- `_knowledge/eval-baseline.json` 커밋 파일 + 검증 훅 (fail-open)
- `promote`: 실패 질문 → 개선 노트 → questions.jsonl 순환

검색 점수가 안정된 뒤에 해야 게이트가 의미 있습니다. 지금 하면 매 버전 기준선이
흔들립니다.

## Phase 4 — 생성층 (Gemma 4 챗봇) — 이 로드맵 밖

- `knowledge-query` 위에 생성 모델을 얹는 답변 계층. 후보: Gemma 4 26B A4B (로컬)
  또는 Claude.
- **별도 지표 필요**: retrieval recall이 아니라 인용 충실도 (답이 top-k 근거만 쓰는지).
- 검색 recall 0.8+ 도달 전에는 시작 안 함 — 근거가 없으면 생성층은 지어냅니다.

플러그인 강화 범위는 Phase 3까지이고, Phase 4는 별도 결정으로 남깁니다.

---

## 플러그인에 랜딩하는 작업 목록 (R1 → R4)

Phase를 플러그인 변경 단위로 옮기면:

- **R1 측정 도구 강화 — 완료 (v1.12.0)** — `eval --sweep 0.3,0.4,0.5`: 질의 임베딩을
  비율 간 공유하고 비율마다 hits/MRR과 **첫 비율 대비 질문별 개선·회귀 목록**을 출력.
  동점을 승자로 부르지 않도록 `decisive` 플래그 포함. 승격 축출 진단
  `relation_participant_evicted_ids` 추가.
- **R2 기본값 교체** — 스윕 승자를 `fusionWeights` 기본값으로 (측정 근거 주석 포함,
  `decisive: true`일 때만); 축출 진단이 승격을 지목하면 `WINDOW_SHARE` 조정;
  `documents_windowed`가 크면 rag-corpus-builder에 청크 상한 규칙.
- **R3 리랭커 계약 — 완료 (v1.13.0)** — `--reranker-url` / `--reranker-model` /
  `--rerank-depth`. Cohere·Jina `/v1/rerank` 형식(llama.cpp `--pooling rank`, TEI 호환).
  창 구성 **전에** 재정렬하므로 승격의 회수 보장이 유지됨. 실패 시 융합 순서로 폴백 +
  `rerank_error` 기록, eval은 `reranker` 블록으로 비교 가능성을 표시.
  스킬 쪽: `knowledge-query`에 부착·실패 판독 규칙, `local-sqlite.md`에 천장 측정법,
  `sqlite-index-builder`에 리랭커 전 `recall@50 − recall@10` 확인 단계.
- **R4 루프 닫기** — eval-baseline.json 규약 + fail-open 훅, `promote` 커맨드.

## 안 하기로 유지

- 새 스킬 추가 (131개 동결, 기존 스킬에 흡수)
- 플러그인 런타임 의존성 (ollama·리랭커 전부 사용자 부착)
- 온톨로지 (E6) — eval이 격차를 지목하기 전까지 Later 유지
