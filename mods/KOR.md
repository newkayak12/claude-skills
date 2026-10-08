# mods (베타)

claude-skills 워크플로를 위한 Claude Code 모드(function hook): 스킬 토스트, 안전 가드.

## 설치 & 제거

```bash
/plugin install mods@newkayak12-claude-skills
/plugin uninstall mods@newkayak12-claude-skills
```

## 요구 사항

Claude Code 2.1.292 이상. 이전 빌드는 stderr에 한 줄을 출력하고 모드를 건너뜁니다. 다른 기능에는 영향이 없습니다. 모드가 로드되지 않으면 Claude Code 시작 전에 환경 변수 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`을 설정하세요.

## 기능

| # | 기능 | 동작 | 범위 |
|---|---|---|---|
| 1 | 스킬 토스트 | 이 마켓플레이스의 스킬이 호출되면 토스트와 상태줄 표시 | 인터랙티브 |
| 2 | Agent 모델 가드 | model 없이 `Agent`를 호출하면(부모 모델 사용) 동작. `fork`는 항상 통과. 아래 옵션 참고 | 모든 세션 |
| 3 | 실행 중 스크립트 가드 | 실행 중인 `.sh`/`.bash` 파일의 Edit/Write를 거부 | 모든 세션 |
| 4 | 워크트리 가드 | 커밋되지 않은 변경이 있는 워크트리의 `git worktree remove --force`를 거부. 경로가 없으면 통과 | 모든 세션 |
| 5 | fetch 알림 | 세션 시작 시(인터랙티브 세션에서만) fetch 후 `origin/main`이 앞서 있으면 토스트 | claude-skills 저장소 전용 |
| 6 | push / bump 확인 | `git push`와 `patch-harness` / `patch-teams` 버전 범프 스크립트 실행 전 확인. Run을 선택하지 않으면 명령이 거부됨(프롬프트를 닫아도 거부). 헤드리스 세션은 묻지 않고 통과 | claude-skills 저장소 전용 |
| 7 | KOR 없는 README | `git commit` 시 스테이징된 `README.md`에 `KOR.md`가 없으면 토스트 | claude-skills 저장소 전용 |
| 8 | `claude -p` 개수 | 턴 종료 시 이 세션의 헤드리스 자식 수를 `n claude -p child(ren) running`으로 상태줄 표시. 0이면 해제 | 인터랙티브 |

"claude-skills 저장소 전용"은 세션 저장소의 remote가 `/claude-skills(\.git)?$/`와 일치할 때만 동작한다는 뜻입니다. 다른 저장소에서는 세 기능 모두 아무것도 하지 않습니다. 인터랙티브 전용 기능은 헤드리스(`claude -p`) 세션에서 동작하지 않습니다.

`claude -p` 개수는 세션 단위입니다. 이 세션의 엔진 프로세스 아래에서 시작된 프로세스만 셉니다. 벗어난 프로세스(nohup, setsid, pid 1로 재부모화된 데몬)는 세지 않습니다.

## 옵션

`agent_model_guard` (`/config`에서 설정, 기본값 `toast`):

- `toast`: 경고만 하고 호출은 진행.
- `deny`: 호출 차단. 활성화: `/config`를 열어 `mods.agent_model_guard`를 찾아 `deny`로 설정. 모드는 이 설정을 직접 쓰지 않습니다.
- `off`: 아무것도 하지 않음.

## 상태와 알려진 한계

- 베타(`0.1.0-beta.4`): 실행 밴드와 스캐너 제거(harness가 그림); 알림에 아이콘(◆ ⚠ ↓ ⧗).
- 스킬 토스트는 플러그인 위치에서 마켓플레이스 파일을 읽을 수 있어야 하며, 읽지 못하면 토스트가 없습니다.
- Agent 가드는 정의에 모델이 이미 고정된 서브에이전트 타입도 경고합니다. 호출 자체의 `model` 인자만 보기 때문입니다.
- 워크트리 가드는 같은 명령 앞의 `cd <dir> &&`를 무시합니다. 경로는 `-C <dir>` 또는 세션 디렉터리로만 해석합니다.
- `claude -p` 개수는 턴 종료 시점의 스냅샷이며 실시간이 아닙니다.
