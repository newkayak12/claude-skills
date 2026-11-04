# teams pane — 패널별 설명 (검토·재구성용)

2026-11-04, teams 0.63.0 기준. 사용자 요청: "내용이 실효성 있는지 모르겠음 / 각 패널 설명 써주고 내가 검토하고 재구성할 수 있음".
각 항목: **보여주는 것 · 데이터 출처 · 언제 쓸모 · 평가(실효성)**. 평가는 Claude의 의견이고, 결정은 사람이 한다.
고칠 때는 아래 각 항목의 `결정:` 줄에 유지 / 삭제 / 이동 / 변경을 적어 주면 그대로 카드 125(pane 품질) 범위가 된다.

코드 위치: 그리기 `teams/hooks/mod.tsx`, `teams/hooks/teams-draw.tsx`; 데이터 `teams/scripts/lib/view-summary.mjs`
(`view.mjs --once`가 같은 함수로 출력), 키 `teams/hooks/pane.ts`.

---

## 0. 상단 — EPIC 목록 (모든 탭 공통)

```
▸ ● E-0ad41780  ⑂ claude-skills · Backlog…        running  0/0  4m
  ● E-6ff25a30  ⑂ claude-skills-c121 · Ba…        running  0/0  22m
```
- 보여주는 것: 실행 중인 EPIC 한 줄씩 — 선택 표시 `▸`, 상태 아이콘, 키, `⑂ 워크트리`, 제목, 상태 단어, 완료/전체 STORY, 경과 시간.
- 출처: tasks root의 task.json들 중 이 저장소(git common dir)와 같은 것, 실행 중만.
- 쓸모: 여러 EPIC 중 무엇을 보고 있는지, 각각 살아 있는지.
- 평가: **필요. 지금은 읽히지 않음.** 제목이 요청문 첫 단어라 `Backlog…`로 잘려 무슨 일인지 모름(카드 127). `⑂ claude-skills`는
  main checkout인데도 붙어 폭만 먹음(같은 checkout이면 생략 가능). `0/0`은 STORY가 생기기 전(Plan 단계) 의미 없음.
- 결정:

## 1. 탭 줄

```
● Home  Floor  STORYs  Decisions  Log  Report        $2.47 · 3 turns
```
- 보여주는 것: 탭 6개, 오른쪽에 선택 EPIC의 비용과 turn 수.
- 평가: 비용이 아래 COST 타일과 **중복**. 탭 6개 중 Floor/Log/Decisions의 경계가 이름만으로는 안 갈림(아래 참고).
- 결정:

---

## 2. Home 탭

### 2a. 상태 줄 + 진행 막대
```
RUNNING ░░░░░░░░░░░░░░░░░░░░░ 0%
▸ Plan
```
- 보여주는 것: EPIC 상태 단어, 6단계 중 끝난 비율 막대, 지금 단계.
- 출처: `stages` (view-summary `stagesOf`) — 6단계(Plan/Build/Integrate/QA/Gate/Report) 중 done 개수.
- 평가: **정보량 낮음.** Plan이 전체 시간의 큰 몫인데 막대는 단계 수로만 움직여 오래 0%에 머묾. `▸ Plan`은 아래 2d 단계 레일과 **중복**.
  실제로 궁금한 건 "지금 누가 뭘 하고 있나" — 그건 Floor 탭에만 있음.
- 결정:

### 2b. 타일 4개
| 타일 | 값 | 출처 | 평가 |
|---|---|---|---|
| PROGRESS | 0% · 0/6 stages | stages | 2a 막대와 **완전 중복** |
| STORIES | 0/0 accepted | packages 중 accept 수 | STORY가 생긴 뒤에만 의미. 2e 레인 합계와 중복 |
| COST | $2.47 · 3 turns | 드라이버 stream 로그 비용 합 | 탭 줄 오른쪽과 중복. 예산(budget) 대비가 없으면 판단 근거가 없음 |
| NEEDS YOU | 0 · nothing | waiting_human 노드 + asks | **유일하게 행동을 부르는 값.** 0일 땐 자리만 차지 |
- 결정:

### 2c. 실행 수치
```
Drivers  2/4 live
Denials  0
Defects  0 filed · 0 dropped
```
- Drivers: 살아 있는 `claude -p` 수 / 상한. **주의: 머신 전체 값**(max_live_drivers, 모든 task 합)이라 이 EPIC 것이 아님 —
  위 화면의 2/4는 두 EPIC 합. 멈춘 드라이버가 있으면 `Stalled P2 23m` 줄이 추가됨(그건 유용).
- Denials: 이 task 드라이버의 권한 거부 횟수. 0이 아니면 dispatch gate/권한 문제 신호.
- Defects: QA가 등록한/버린 결함 수. QA 단계 전엔 항상 0.
- 그 밖에 있을 때만 나오는 줄: Budget(예산 설정 시), Out of retries(재시도 소진 STORY, 빨강), Scoped out.
- 평가: Stalled/Out of retries/Denials>0 은 **문제 신호라 유용**, 평소엔 "0"만 늘어서 소음. Drivers는 범위가 헷갈림.
- 결정:

### 2d. 단계 레일
```
◉ 1 Plan ┄┄ ○ 2 Build ┄┄ ○ 3 Integrate ┄┄ ○ 4 QA ┄┄ ○ 5 Gate ┄┄ ○ 6 Report
```
- 출처: stages. 끝난 구간은 `━━`, 남은 구간 `┄┄`.
- 평가: 2a·2b PROGRESS와 같은 정보를 세 번째로 보여줌. 셋 중 하나만 남기면 이게 가장 잘 읽힘.
- 결정:

### 2e. 레인 4개 (칸반 요약)
```
● Active 0   ● On you 0   ● Next 0   ● Done 0
```
- 출처: packages(STORY) 상태별 개수 — 진행 중 / 사람 대기 / 대기열 / 완료. 넓으면 칸 안에 STORY 제목도 나옴.
- 평가: STORY가 생긴 뒤(Build부터)엔 **가장 유용한 한눈 요약.** Plan 단계에선 전부 0. "On you"는 NEEDS YOU와 겹침.
- 결정:

### 2f. 바닥 줄 (키 안내)
```
◀ ▶ [ ] EPIC · j k row · 0-5 tabs ⏎ submit  q close
```
- 평가: 입력칸에 쳐서 ⏎ 해야 한다는 점이 잘 안 드러남. `◀ ▶`는 버튼(마우스/터치)이고 `[ ]`는 키 — 같은 기능을 두 번 표시.
- 결정:

---

## 3. Floor 탭 — "지금 누가 뭘 하나"
- 보여주는 것: (1) 사람에게 온 질문 `⚑ P2 → you  <질문>` (있을 때 맨 위), (2) 일하는 주체 한 줄씩 — 노드/STORY, 스피너, 하는 일,
  경과, (3) 최근 hand-off `보낸 쪽 → 내용 → 받는 쪽` (judge 판정, QA 결함 등록, integrate, STORY↔TeamLeader 질문·답).
- 출처: `workers`, `handoffs` (view-events.mjs).
- 평가: **실시간 감시에 가장 쓸모 있는 탭인데 Home 뒤에 숨어 있음.** Home의 2a/2b/2d를 줄이고 이 내용을 Home으로 올리는 안을 제안.
  agent 간 대화를 스레드로 보는 건 카드 126.
- 결정:

## 4. STORYs 탭 — STORY 표
- 보여주는 것: 맨 위 단계 레일(2d와 같음), STORY 한 줄씩 — 키, 상태, 제목, 시도 n/3, 판정 점수 vs 기준, 비용, 경과; 아래 줄에 거절 사유.
  `j`/`k`로 행 이동, `g`로 그 STORY의 run 열기.
- 평가: 실패 원인 추적에 **필요.** 단계 레일 반복은 불필요.
- 결정:

## 5. Decisions 탭 — 결정 기록
- 보여주는 것: brainstorm/사람/엔진이 정한 결정(`task.decisions`: 질문 · 선택 · 이유 · 누가), 카드를 고르면 그 카드의 질문/답 스레드.
- 평가: 사후 확인용("왜 이렇게 했지?"). 실행 중엔 거의 안 봄. Report 탭에 합쳐도 됨.
- 결정:

## 6. Log 탭 — 이벤트 기록
- 보여주는 것: ledger 이벤트를 시간순 한 줄씩(노드 실패, 사람 대기, 한도 정지, 데몬 종료 등 사람이 읽을 것만 추린 것).
- 평가: Floor의 hand-off와 일부 겹침. 문제가 생겼을 때만 봄.
- 결정:

## 7. Report 탭 — 보고서
- 보여주는 것: 끝난 EPIC의 `80-report.md`(결과, 판정, 남은 일). 실행 중엔 비어 있음.
- 평가: 끝난 뒤에만 의미. 실행 중엔 탭을 숨기는 편이 낫다.
- 결정:

## 8. band (프롬프트 위 한 줄) / 끝날 때 카드
```
teams · ⑂ claude-skills-c121 · Backlog cards 121, 112 — Planning ──── 0/0 done [ board ]
```
- 보여주는 것: 지금 EPIC, 단계, 완료 수, `[ board ]` 버튼(pane 열기). 사람에게 질문이 오면 `⚑` 줄로 바뀜. 끝나면 보고서 카드.
- 평가: 제목 문제는 0과 같음(카드 127). 질문 `⚑`은 유용.
- 결정:

---

## Claude의 재구성 제안 (참고용)

Home 한 화면에 "행동이 필요한가 → 누가 뭘 하나 → 어디까지 왔나" 순서로:
1. EPIC 목록 (키 · 자연어 이름 · 단계 · 경과) — 카드 127
2. ⚑ 사람에게 온 질문 / 멈춘 드라이버 / 재시도 소진 (있을 때만, 없으면 줄 자체가 없음)
3. 일하는 주체 목록 (현재 Floor의 worker 줄)
4. 단계 레일 한 줄 + STORY 레인 (Build 이후)
5. 비용 · 예산 한 줄

빼는 것: 진행 막대, PROGRESS·STORIES·NEEDS YOU 타일(위로 흡수), 평소 0인 Denials/Defects 줄, Drivers(머신 전체 값).
탭: Home · STORYs · Log · Report(끝난 뒤) 넷으로 — Floor는 Home으로, Decisions는 Report로.

---

## 확정안 (2026-11-04, 사람 결정) — 위 항목별 `결정:`을 대신한다

사람의 결정: "HOME에 돌고 있는 EPIC, STORY 계층으로 뿌리고 / STORY 선택 시 전체 FLOW, 진행도, subagent 참가 수,
참가 종류 / FLOOR 에 각 Phase에서 돌고 있는 상세 / Decisions는 Phase 상세에 보여주면 될거고 / Log, Report는 Story
선택시 / 에초에 계층이 잘못됐음 / 조작 키도 wasd, enter". 페르소나 토론(운영자 · 사후 분석가 · 좁은 화면 UX, sonnet)의
후보 F1(드릴다운) / F2(F1 + 좌우 미리보기) 중 **F1**, 좌우 분할 없음 ("전체적으로 훨씬 나음", "좌우는 필요 없어").

탭 6개 대신 페이지 스택. 첫 줄은 breadcrumb.

```
HOME ─ EPIC 행 ⏎ ─▶ FLOOR (EPIC의 6 Phase) ─ ⏎ ─▶ Phase 상세 (돌고 있음 · 넘겨준 일 · 결정)
     └ STORY 행 ⏎ ─▶ STORY 상세 (FLOW · 진행 · 참가 · 시도×노드) ─ ⏎ ─▶ Log / Report
```

| 키 | 동작 |
|---|---|
| `w` `s` | 행 이동 (Log·Report·Phase 상세에서는 스크롤) |
| `d` `⏎` | 열기 |
| `a` | 한 단계 뒤로 (그 단계에서 고른 행은 기억) |
| `n` | 다음 ⚑ (어느 화면에서든) |
| `q` `Esc` | 닫기 (mod.md) |
| ⚑에서 `⏎` | 답변 모드: 글자가 텍스트, ⏎ 보내기, 빈 ⏎ 취소 |

mobile: 같은 동작을 `[▲] [▼] [열기] [뒤로] [⚑] [닫기]` 버튼으로.

함께 넣는 것: ⚑ 구역(질문 · 멈춘 드라이버 · 재시도 소진, 있을 때만) · 끝난 EPIC은 접힌 행으로 남김 ·
worker 행의 `⏸ n분`(엔진의 stall 판정을 읽음, view가 따로 판정하지 않음) · STORY 행의 직전 거절 사유와 점수 ·
STORY Report는 엔진이 쓰고 pane은 읽기만 · Report 끝 줄에 `tm_log`/`tm_retry` 다시 보기.
빼는 것: 좌우 분할, 재시도/중단 키(pane은 읽기 전용), 진행 막대·타일 4개·평소 0인 수치 줄.

Phase = EPIC의 6단계(Plan/Build/Integrate/QA/Gate/Report). STORY 안의 노드(plan…gate)는 STORY 상세의 FLOW.

Mock (가상 데이터): `images/teams-pane-01-home.png` · `02-story` · `03-floor` · `04-phase` · `05-log` ·
`06-report` · `08-mobile` · `09-answer`. 구현은 카드 125의 pane 품질 범위.
