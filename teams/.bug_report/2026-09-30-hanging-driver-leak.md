# teams 테스트: hanging-driver 프로세스 누수

- 발견: 2026-09-30
- 영역: `teams/scripts/test-taskmanager.mjs` (테스트 정리 코드). 제품 버그 아님.
- 상태: 수정됨 (2026-09-30, `killDriversIn`)

## 증상

`node /…/T/tm-drv-XXXX/hanging-driver.mjs Run the development harness …` 프로세스가
PPID=1 고아로 계속 쌓인다. 2026-09-30 기준 하루 이상 된 것만 39개(수동 kill). 프롬프트에
"claude and codex"가 들어가 있어 codex 기본 모델(`gpt-5.6-sol`)이 함께 표시된다.

## 원인

1. `test-taskmanager.mjs`(4557행, 4599행 근처)가 가짜 드라이버 `hanging-driver.mjs`를 만든다.
   내용은 `setInterval(() => {}, 1000)` 한 줄이라 아무것도 안 하고 영원히 떠 있다.
2. teams 데몬은 드라이버를 `detached: true` + `unref()`로 띄운다(`teams/mcp/taskmanager.mjs:2810`,
   `:3117`). 데몬이 재시작돼도 드라이버가 살아남도록 한 의도된 설계다.
3. 테스트는 `finally`에서 데몬 PID만 SIGKILL/SIGTERM으로 죽이고, `s_run.driver.pid`에 적힌
   드라이버 하나만 추가로 정리한다.
4. 그 사이 데몬은 다음 단계(shape 판정, 자식 run)용 드라이버를 또 띄운다. 이들은 각자 별도
   프로세스 그룹이라 데몬이 죽어도 같이 죽지 않고 고아가 된다.
5. 결과: teams 테스트를 한 번 돌릴 때마다 몇 개씩 남는다.

## 해당 테스트

- `a judge call leaves its stream under drivers/, so budget and the report count manager-level spend`
  — 데몬을 SIGKILL로 죽인다(자식 정리 불가).
- `the daemon stays alive while it only has a running child to wait on`
  — 데몬과 `s_run.driver`만 SIGTERM으로 죽인다.

## 수정 방향

테스트 `finally`에서 ledger/task 파일에 기록된 드라이버 PID를 전부 모아 프로세스 그룹 단위로
`process.kill(-pid, 'SIGKILL')` 한다(detached라 각자 그룹 리더). 드라이버가 살아남는 제품 동작은
건드리지 않는다.

`.mjs`는 harness 게이트 대상이므로 plan → setgoal → critique 절차를 거쳐 수정한다.

## 수정 (2026-09-30)

- 원인이 하나 더 있었다. `the daemon stays alive…` 테스트는 `const task`를 `try` 안에서 선언해서
  `finally`의 `task()`가 ReferenceError를 냈고, 빈 `catch`가 삼켰다. 데몬도 드라이버도 한 번도
  죽이지 않았다.
- `killDriversIn(drv)` 헬퍼 추가: 테스트별 fake 드라이버 디렉터리 경로로 `pkill -KILL -f`.
  PID가 어디에 기록됐는지와 상관없이 그 테스트가 띄운 드라이버를 전부 죽인다. 두 테스트
  `finally`에서 데몬을 죽인 뒤 호출한다.
- 검증: 수정본은 2/2 통과, 새 고아 0개. 수정 전 HEAD는 실행마다 1개 남는다.
