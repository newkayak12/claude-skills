# teams wiki — 세션을 넘는 장기 메모리 (2026-10-07)

> 상태: **승인 대기**. 승인 전 코드 없음.
> 근거 문서: `2026-09-28-teams-cards-everywhere.md` (Principles 1–5), `2026-09-17-teams-team.md` §6b
> ("새 층이 메모리 상태를 만든다" 금지).
> 선례: `knowledge/scripts/sqlite-knowledge.mjs` (node:sqlite + FTS5 + BLOB 벡터 + JS cosine).

## 1. 문제

EPIC이 끝나면 지식이 사라진다. `docs.mjs`가 `10-prd.md`·`60-qa.md`를 남기지만 엔진은 다시 읽지 않고
(`docs.mjs:1-3`), 사람이 내린 `decisions[]`는 같은 subgoal의 재시도에만 이어진다. 다음 EPIC은 같은
질문을 다시 묻고 같은 결정을 다시 내린다.

목표: 사람의 Confluence처럼 **페이지 단위로 쌓이고, 사람이 읽고 고칠 수 있고, 다음 세션이 검색해 인용하는**
장기 메모리.

## 2. Plan

### 1단계 — MCP 서버 `teams-wiki` (teams와 독립적으로 동작)

- **원본 = md 파일.** `<project>/.teams_wiki/<space>/<slug>.md`, git 추적. frontmatter:
  `title, space, tags, source, updated, status(accepted|superseded), superseded_by`.
  사람이 직접 열어 보고 고쳐도 된다 — 그게 "사용자에게 보이는 산출물"이다.
- **인덱스 = 버릴 수 있는 부산물.** `.teams_wiki/.index.sqlite` (`.teams_wiki/.gitignore`로 제외).
  md mtime이 바뀌면 다시 색인한다. 지워도 md에서 똑같이 재생성된다.
- **검색 = SQLite FTS5만. 벡터·임베딩 없음** (2026-10-07 사용자 결정: Ollama 안 씀, 외부 모델 의존 없음).
  한국어는 FTS5 trigram + 2음절 prefix (knowledge의 방식 그대로). 찾는 것보다 **이어지는 것**이 핵심이다.
- **이어짐 = 링크 그래프.** 페이지 본문의 `[[space/slug]]`를 파싱해 sqlite `links(from, to)` 테이블에 둔다.
  - `wiki_get`은 전문과 함께 **나가는 링크·백링크**(제목 한 줄씩)를 돌려준다 — 한 페이지를 열면 이웃이 보인다.
  - `wiki_propose`는 본문에 링크가 하나도 없고 비슷한 기존 페이지(FTS 상위)가 있으면 경고한다 — 고립 페이지 방지.
  - 깨진 링크(없는 페이지를 가리킴)는 `wiki_status`가 목록으로 낸다.
- **컨텍스트 유실 방지 = 이어받기 페이지.** 세션(EPIC) 하나가 끝날 때 `log/<날짜>-<source>` 페이지를 남긴다:
  무엇을 결정했고, 무엇이 열려 있고, 어떤 페이지를 읽고/고쳤는지 — 모두 `[[링크]]`로.
  다음 세션은 `wiki_resume()` 한 번으로 최근 log 페이지와 그 링크 1-hop을 받는다. 처음부터 다시 묻지 않는다.
- **`INDEX.md`(렌더 뷰).** 페이지마다 한 줄 `[[id]] — 요약`. 수락 때마다 다시 쓴다. 사람에게는 목차, 모델에게는 지도.
- **도구 8개.**

  | 도구 | 하는 일 |
  |---|---|
  | `wiki_search(query, space?, k=5)` | FTS 검색. id·title·snippet. superseded는 기본 제외 |
  | `wiki_get(id)` | 페이지 전문 + 나가는 링크 + 백링크 |
  | `wiki_resume(k=3)` | 최근 log 페이지 k개 + 그 링크 1-hop (제목·요약) — 세션 시작용 |
  | `wiki_list(space?)` | space/페이지 트리 |
  | `wiki_propose(space, slug, title, body, source, supersedes?)` | `_proposed/`에 제안 작성, 기존 페이지와의 diff·고립 경고 반환 |
  | `wiki_accept(proposal_id)` / `wiki_reject(proposal_id, reason)` | 제안 반영(재색인·INDEX 갱신) / 거절 사유 기록 |
  | `wiki_status()` | 페이지 수, 인덱스 신선도, 깨진 링크 |

- **쓰기는 항상 제안 → 수락.** 작성자가 곧바로 원본을 바꾸지 못한다 (Principle 2를 MCP 수준에서 강제).
  단독 사용 시엔 사람이 `wiki_accept`한다.
- **구현 위치.** `teams/mcp/wiki.mjs` (stdio JSON-RPC는 `taskmanager.mjs`의 패턴 복사),
  `teams/.mcp.json`에 `teams-wiki` 서버 추가. 동시 수락은 `store.mjs`와 같은 lock 디렉터리 방식.
- **런타임.** `node:sqlite`는 Node 24+ 또는 22.5–23 + `--experimental-sqlite`. teams는 "Node 18+"을
  표방하므로 **wiki 서버만** 이 요구를 갖고, 불가하면 명확한 오류를 내고 teams 본체는 영향 없이 돈다.

### 2단계 — teams에 녹이기

- **읽기:** EPIC 시작(sizing) 때 `wiki_resume()` 결과를 task에 붙여 investigate/plan 프롬프트(`prompts.mjs`)로
  넘긴다. 단계마다 `wiki_search`/`wiki_get`으로 더 따라가고, 쓴 페이지는 id로 인용. 요약만, k≤5 (프롬프트 비대 방지).
- **쓰기:** EPIC report 단계가 이번 EPIC의 결정·PRD 결론·QA 교훈을 `wiki_propose`(source=EPIC id),
  그리고 이어받기용 `log/` 페이지 하나 — 읽은 페이지·고친 페이지·열린 질문을 링크로.
  기존 페이지와 모순되면 `supersedes`로 대체 제안 — 지우지 않는다.
- **판정:** EPIC 최종 gate가 report와 함께 제안들을 accept/reject. 새 노드를 만들지 않는다.
- **보이기:** report 문서(`docs.mjs`)에 "Wiki 변경" 절 — 수락/거절된 페이지, 경로, 사유.
  (viewserver Wiki 탭은 이번 범위 밖.)

## 3. Done when (setgoal)

1단계
- [ ] `node --test`: propose → accept → search가 한국어·영어 키워드로 해당 페이지를 1위로 찾는다.
- [ ] supersede된 페이지는 기본 검색에서 빠지고 `superseded_by`로 새 페이지를 가리킨다.
- [ ] `.index.sqlite`를 지우고 재색인해도 같은 검색 결과.
- [ ] `[[링크]]`가 links 테이블에 들어가고 `wiki_get`이 백링크를 돌려준다. 깨진 링크는 `wiki_status`에 나온다.
- [ ] `wiki_resume`이 최근 log 페이지와 그 링크 1-hop을 돌려준다.
- [ ] 링크 없는 제안이 비슷한 기존 페이지가 있을 때 고립 경고를 받는다.
- [ ] 외부 모델·네트워크 호출 0 (임베딩 없음).
- [ ] 두 프로세스가 동시에 accept해도 md·인덱스가 깨지지 않는다.
- [ ] stdio 스모크: `tools/list`가 도구 8개를 돌려준다.
- [ ] Node 22.12(현 로컬)와 24에서 기동 확인.

2단계
- [ ] bench fixture에서 EPIC 1이 제안 → gate 수락 → EPIC 2가 `wiki_resume`으로 이어받아 investigate가 그 페이지 id를 인용.
- [ ] EPIC 2가 EPIC 1에서 이미 결정된 질문을 다시 사람에게 묻지 않는다 (컨텍스트 유실 없음의 실측).
- [ ] report md에 "Wiki 변경" 절이 나온다.
- [ ] wiki 서버가 꺼져 있어도 EPIC이 끝까지 돈다 (wiki는 선택 기능).

## 4. Critique (원칙 대조)

| 원칙 | 판정 |
|---|---|
| P1 6단계 안의 6단계 | 새 체인을 만들지 않음. 읽기는 investigate, 쓰기는 report 안. ✓ |
| P2 단계마다 gate, 작성자 자기판정 금지 | 쓰기는 제안만, 수락은 gate/사람. MCP가 강제. ✓ |
| P3 두 번 쪼개기 | 무관. ✓ |
| P4 planning 산출물 필수 | wiki는 PRD를 대체하지 않음 — PRD 결론을 *추가로* 남길 뿐. ✓ |
| P5 작업은 카드로 | wiki 쓰기는 report 단계의 일부라 별도 카드 아님. **경계 사례** — 카드로 만들자는 의견이면 재론. |
| §6b 메모리 상태 금지 | 상태는 전부 파일(md + 버릴 수 있는 sqlite). ✓ |
| docs.mjs "md는 렌더 뷰" | wiki md는 렌더 뷰가 아니라 **원본**이다. task.json과 별개의 원본이고 인덱스가 파생 — 방향은 같음. 주석으로 구분 명시. |

위험
- **틀린 기억의 전파:** source·updated 필수, 반박 시 supersede. gate가 근거 없는 제안을 거절.
- **knowledge 플러그인과 기능 중복:** 의도적. teams는 knowledge에 결합하지 않는다 (설치 안 해도 동작).
  검색 방식은 복사해 오되 코드 import는 하지 않는다.
- **Node 버전:** wiki 서버만 22.5+/24+. README에 명시.

## 5. 열린 질문

- 저장 위치 `.teams_wiki/`(프로젝트, git 추적) vs `~/.harness/wiki/`(사용자 전역). → 기본값은 프로젝트.
  팀원과 공유된다는 점이 Confluence에 더 가깝다.
