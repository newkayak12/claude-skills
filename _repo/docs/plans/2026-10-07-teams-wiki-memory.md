# teams wiki — 세션을 넘는 장기 메모리 (2026-10-07)

> 상태: 1단계 출시(v0.42.0). 1b·2단계 출시(v0.44.0). 실측 bench만 남음(별도 승인).
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
- **런타임.** **Node 24+.** 실측(2026-10-07): Node 22.12는 `--experimental-sqlite`로 `node:sqlite`가
  로드돼도 FTS5 모듈이 없다(`no such module: fts5`). teams는 "Node 18+"을 표방하므로 **wiki 서버만** 이
  요구를 갖는다 — sqlite는 첫 도구 호출 때 지연 로드, 그 아래 버전에선 서버는 뜨고 `tools/list`도 되지만
  `wiki_*` 호출은 "Node 24 필요" 오류를 낸다. teams 본체는 영향 없음.

### 1b단계 — FTS5 없는 런타임 fallback (2026-10-07 개정, 사용자 승인)

1단계는 FTS5가 없으면(Node 22.12 실측) `wiki_*`가 오류를 냈다. teams가 daemon을 띄운 Node로 돌기 때문에
통합하면 wiki가 **조용히 꺼진 채** EPIC이 진행된다. Node 24 강제(경로 탐색)는 설치 방식마다 깨지므로 하지 않는다.

- **scan 모드.** `node:sqlite`+FTS5가 없으면 md를 직접 읽어 JS로 검색한다 — 같은 토큰화(단어 + trigram +
  한국어 2음절 prefix·조사 처리), 같은 순위 규칙, 같은 tie-break(score → id). 링크·백링크·`wiki_resume`·고립 경고도
  md 파싱으로 같은 결과. md가 원본이라 정합성 문제 없음; sqlite는 가속기일 뿐이다.
- **Node 18+ 어디서든 wiki가 켜진다.** "Node 24 필요" 오류는 없어진다.
- **모드는 항상 보인다.** `wiki_status.mode = "fts5" | "scan"`; 2단계에서 `tm_status`와 report에도 표시.
- 쓰기(propose/accept/reject/lock/INDEX.md)는 모드와 무관하게 같은 코드.

### 2단계 — teams에 녹이기 (2026-10-07 개정: 코드 조사 결과 반영)

조사로 확인한 사실: worker는 MCP를 못 쓴다(`claude-exec-adapter.mjs:47`, `--strict-mcp-config` 빈 서버 목록).
report 노드는 `gate:goal` **뒤에** 돈다(`taskmanager.mjs:1142`). daemon은 `taskmanager.mjs`를 라이브러리로 import한다.

- **엔진이 직접 부른다.** 새 `teams/mcp/wikibridge.mjs`가 `wiki.mjs`의 `callTool`을 프로세스 안에서 호출.
  root는 항상 `task.cwd`(메인 프로젝트) — worktree에서 읽거나 쓰지 않는다. `setRoot`가 모듈 전역이라 호출은
  직렬화하고 매번 root를 설정, 끝나면 `close()`. 모든 호출은 try/catch + `isError` 확인 — 실패해도 EPIC은 진행.
- **읽기:** `createTask`(`taskmanager.mjs:384`)가 이미 이어 붙이는 context에 `wiki_resume` 결과(요약, k≤3)를 붙인다.
  → `childContext`/`composePrompt`의 "Context from the requester"로 investigate·plan까지 간다. 페이지는 id로 인용하라는 한 줄.
- **쓰기 = 엔진이 결정적으로 만든다 (모델이 쓰지 않음).** `gate:goal`이 ready가 될 때 엔진이 task.json에서
  `log/<날짜>-<EPIC id>` 페이지를 `wiki_propose`: 요청 한 줄, `task.decisions`(누가 무엇을 결정), 열린 질문,
  이번에 resume으로 읽은 페이지 `[[링크]]`, PRD·report 문서 경로. 제안 id는 `task.wiki.proposals`에(mutateTask).
- **판정 = gate:goal.** 계약(`stagecontract.mjs:81`)에 선택 필드 `wiki_decisions: [{proposal_id, accept, reason}]`,
  gate 프롬프트에 제안 본문. fold 때 엔진이 `wiki_accept`/`wiki_reject`. gate가 아무 말 없으면 제안은 `_proposed/`에
  남는다(사람이 나중에 수락 가능) — 자동 수락 없음.
- **보이기:** `docs.mjs` `renderReport`에 "Wiki 변경" 절(제안·수락·거절, 경로, 사유, 모드). `tm_status`에 wiki 모드.
- **범위 밖:** 모델이 쓰는 지식 페이지(교훈·PRD 결론), viewserver Wiki 탭, worker의 직접 검색. log 페이지가 링크로
  이어지는 걸 먼저 실측한 뒤 재론.

## 3. Done when (setgoal)

1단계
- [x] `node --test`: propose → accept → search가 한국어·영어 키워드로 해당 페이지를 1위로 찾는다.
- [x] supersede된 페이지는 기본 검색에서 빠지고 `superseded_by`로 새 페이지를 가리킨다.
- [x] `.index.sqlite`를 지우고 재색인해도 같은 검색 결과.
- [x] `[[링크]]`가 links 테이블에 들어가고 `wiki_get`이 백링크를 돌려준다. 깨진 링크는 `wiki_status`에 나온다.
- [x] `wiki_resume`이 최근 log 페이지와 그 링크 1-hop을 돌려준다.
- [x] 링크 없는 제안이 비슷한 기존 페이지가 있을 때 고립 경고를 받는다.
- [x] 외부 모델·네트워크 호출 0 (임베딩 없음).
- [x] 두 프로세스가 동시에 accept해도 md·인덱스가 깨지지 않는다.
- [x] stdio 스모크: `tools/list`가 도구 8개를 돌려준다.
- [x] (1단계 출시 v0.42.0 — 1b로 대체됨) Node 24에서 전 기능, Node 22.12에서 기동 + 명확한 오류.

1b단계
- [x] test-wiki 전체를 fts5·scan 두 모드로 돈다(scan은 강제 env로); DW1 검색 1위, 링크·백링크, resume, 고립 경고가 두 모드에서 같다.
- [x] Node 22.12에서 `wiki_*`가 오류 없이 scan 모드로 동작, `wiki_status.mode === "scan"`.
- [x] Node 18 문법만 사용(scan 경로에 node:sqlite import 없음).

2단계
- [x] `createTask`가 wiki에 log 페이지가 있을 때 그 요약을 task context에 넣고, 없거나 wiki가 실패하면 context가 이전과 바이트 동일.
- [x] `gate:goal` ready 시 log 제안이 정확히 1번 생긴다(재시도·daemon/tm_next 경합에도 1번) — 제안 id가 task.json에.
- [x] gate 결과의 `wiki_decisions` accept → 페이지가 `.teams_wiki/log/`에, reject → `_rejected/`에. 필드 없음 → `_proposed/`에 남음.
- [x] wikibridge가 `task.cwd`를 root로 쓴다 — worktree 경로로 호출해도 메인 프로젝트에 쓴다.
- [x] wiki 호출이 throw/isError여도 EPIC 테스트 흐름이 끝까지 간다.
- [x] report md "Wiki 변경" 절, `tm_status`에 모드.
- [x] 기존 teams 테스트 전체 green.
- 실측(별도 승인 후, 비용 발생): bench fixture EPIC 1 → EPIC 2가 log를 이어받아 이미 결정된 질문을 다시 묻지 않는다.

## 4. Critique (원칙 대조)

| 원칙 | 판정 |
|---|---|
| P1 6단계 안의 6단계 | 새 체인·노드 없음. 읽기는 createTask context, 쓰기는 gate:goal 직전 엔진 동작. ✓ |
| P2 단계마다 gate, 작성자 자기판정 금지 | log 페이지는 엔진이 task.json에서 결정적으로 만들고(모델 작성 없음), gate:goal(별도 judge)이 수락. 자동 수락 없음. ✓ |
| P3 두 번 쪼개기 | 무관. ✓ |
| P4 planning 산출물 필수 | wiki는 PRD를 대체하지 않음. ✓ |
| P5 작업은 카드로 | wiki 쓰기는 엔진 bookkeeping이라 카드 아님 — 모델 작업이 아니므로 경계 사례 해소. ✓ |
| §6b 메모리 상태 금지 | 제안 id·결정은 task.json(mutateTask), wiki 핸들은 await judge를 넘겨 들고 있지 않음. ✓ |
| docs.mjs "md는 렌더 뷰" | wiki md는 원본, sqlite·INDEX.md가 파생. 주석으로 구분 명시. ✓ |
| 1b scan 모드 | 두 검색 경로 = 중복 코드 위험. 토큰화·순위를 한 함수로 공유하고 저장소만 다르게(sqlite vs 메모리 배열). |

위험
- **틀린 기억의 전파:** source·updated 필수, 반박 시 supersede. gate가 근거 없는 제안을 거절.
- **knowledge 플러그인과 기능 중복:** 의도적. teams는 knowledge에 결합하지 않는다 (설치 안 해도 동작).
  검색 방식은 복사해 오되 코드 import는 하지 않는다.
- **Node 버전:** 1b 이후 Node 18+ 어디서든 동작(scan). fts5는 가속일 뿐.
- **gate 부담:** gate:goal 프롬프트가 log 제안만큼 길어진다 — 요약 위주, 본문 상한.
- **경합:** log 제안은 claim(store.mjs 방식)으로 1회 보장.

## 5. 열린 질문

- 저장 위치 `.teams_wiki/`(프로젝트, git 추적) vs `~/.harness/wiki/`(사용자 전역). → 기본값은 프로젝트.
  팀원과 공유된다는 점이 Confluence에 더 가깝다.
