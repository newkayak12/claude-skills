# 재검증 3: 항목 1·2·3을 코딩 지침(Think / Simplicity / Surgical / Goal-driven)으로

작성 2026-09-30. 대상: 06의 축소 계획 — 1 큐 쓰기 중단, 2 `--check-stale`, 3 WCD 표 추가.
전부 파일을 열어 확인했다. 확인 못 한 것은 그렇다고 적었다.

## 항목 1 — 훅이 소비자 없는 큐를 쓰지 않게 한다

**확인한 사실**
- 큐 쓰기는 **문서화된 동작**이다: README `## Hook` "It queues a single-note catalog upsert and ... an answerability recheck".
- 테스트 4개가 큐 생성을 단언한다(`hooks/knowledge-delta-check.test.mjs:45,63,93,145`).
- 소비자는 플러그인·knowledge-chat 어디에도 없다(`server bin bench web` 포함 grep 0건).
- knowledge-chat에서 큐는 `.gitignore:21 **/_knowledge/`로 무시되고 크기 228K.

**판정: 하지 않는다 (지금은).**
- Surgical: 고장 난 게 아니라 "아무도 안 읽는 로그"다. 피해는 gitignore된 228K. 요청과 직접 이어지지 않는다.
- Simplicity: 지우면 문서화된 동작 제거(README·KOR·테스트 4개 수정), 소비자를 만들면 새 기능. 둘 다 문제 크기보다 크다.
- 00~06에서 이걸 "critical"로 올린 건 과장이었다. 실측은 "쌓인다"였지 "해를 끼친다"가 아니었다.
- 할 거라면 최소형: README `## Hook`에 "큐는 참고용 기록이며 플러그인이 소비하지 않는다" 한 줄. → verify: README·KOR 동시 반영.

## 항목 2 — 검증기 `--check-stale` (노트 `sources:` 해시 비교)

**확인한 사실**
- 검증기는 이미 **볼트 내부** 낡음을 잡는다: `complete` 답변의 `answer_note_hashes`가 노트 현재 해시와 다르면 에러
  (`scripts/validate-knowledge.mjs:294-305`). 없는 건 **소스→노트** 방향뿐.
- knowledge-chat 4,168노트 중 frontmatter `sources:`가 있는 건 **574개(14%)**. 나머지는 본문 `**코드 앵커**` 불릿에 경로를 적는다.
- 경로의 기준 루트가 없다: `src/main/java/kr/cfms/...`(어느 레포?), `colo-frontend/apps/...`(레포 접두), 디렉터리(`src/main/java/kr/cfms/itf`)가 섞여 있다.
- 기록된 기준 해시가 없으므로 첫 실행은 아무것도 검출할 수 없다(기준선만 생긴다).

**판정: 이 형태로는 만들지 않는다. 전제가 성립하지 않는다.**
- Think: "노트가 해석 가능한 소스 경로를 갖는다"는 가정이 86% 노트에서 거짓이다. 만들면 14%만 검사하는 도구가 된다.
- Simplicity: 다중 레포 루트 매핑, 디렉터리 해시, 본문 불릿 파싱까지 가면 요청 없는 설정·추상화가 붙는다.
- 먼저 풀 질문(사용자 결정): 드리프트가 **플러그인** 문제인가, knowledge-chat이 플러그인 계약(frontmatter `sources:`)을
  안 따르는 **볼트 쪽** 문제인가. 후자라면 플러그인 코드 변경 0이 정답이다.
- 가장 작은 다음 단계(코드 없음): knowledge-chat에서 `a6d71ed`("코드와 어긋난 노트 정정")가 고친 노트 수와 그 노트들이
  `sources:`를 가졌는지 센다. → verify: 숫자 2개. 드리프트가 실제로 얼마나 자주, 어떤 노트에서 나는지부터 안다.

## 항목 3 — 6개 스킬에 `What Claude Does / What You Do` 표 추가

**확인한 사실**
- 규칙은 있다: `write/skills/writing-skills/SKILL.md:80` 필수 섹션 목록.
- 강제는 없다: `_repo/scripts/validate_plugins.py`는 200줄 넘는 스킬의 `Standing Mandates`만 경고(:212), WCD는 검사 안 함.
- 저장소 전체가 불균일하다(WCD 보유/스킬 수): cognition 10/10, portfolio 9/9, develop 30/33, teams 7/15, think 4/8,
  write 3/5, **knowledge 2/8**, harness 0/5, agents 0/3, graph 0/2, planning 0/2, skill 0/2, completion 0/1.

**판정: 싸고 안전하지만, 가치는 "완성도 = 저장소 규칙 준수"일 때만.**
- Surgical: 섹션 추가만, 본문 불변이면 요청 추적 가능. 길이 축소·섹션 이름 통일은 하지 않는다.
- Think: knowledge만 유독 뒤처진 게 아니다(harness 0/5 등). 이걸 "knowledge 완성도 1순위"로 부를 근거는 약하다.
  사용자가 스킬을 써서 얻는 결과(해석 b)는 이 표로 바뀌지 않는다.
- 한다면: 6개 스킬 각 표 1개(3~4행, 기존 스킬의 WCD 형식 따름) → verify: `grep -L "What Claude Does" knowledge/skills/*/SKILL.md` 출력 0줄
  + `python3 _repo/scripts/validate_plugins.py` 통과 + 버전 bump·README/KOR.

## 종합

| 항목 | 판정 | 이유 한 줄 |
|---|---|---|
| 1 큐 | 보류 (README 한 줄만 선택) | 피해가 gitignore된 228K — 코드 변경은 문제보다 크다 |
| 2 stale | 이 형태는 폐기 | 86% 노트에 해석 가능한 소스 경로 없음 — 전제 불성립 |
| 3 WCD | 조건부 진행 | 해석 (a)일 때만 가치, 비용은 작다 |

**반복된 실수의 정정:** 00~06 동안 항목 1·2를 "실측된 결함"으로 올렸지만, 실측된 건 현상(쌓임, 정정 커밋)이었고 해악·범위는
재지 않았다. 코드를 열어 보니 1은 해가 작고 2는 전제가 없다.

## 사용자 결정 필요
1. 완성도 해석: (a) 규칙 준수 / (b) 사용 결과 품질 / (c) 실제 볼트 유지 — (a)면 항목 3 진행.
2. 드리프트: 플러그인 문제로 볼지, knowledge-chat이 `sources:` 계약을 따르게 할지.
