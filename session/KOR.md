# session

Claude Code 세션이 남긴 것(변경한 파일, 커밋, 거부된 호출, 도구 호출 사이 가장 긴 간격)을 보여 주고, 다음 시작 때 밴드로 다시 보여 주며, 남아 있는 `claude -p` 자식 프로세스를 나열하고 안전하게 중지하며, 위험한 명령과 비밀 파일 쓰기를 가드하고, `/memo` 메모를 보관하고, 정한 %에서 recap 뒤 compact하며, 그 recap을 `/handoff`·`/recap`·`/lessons`에 쓰고, 작업 시간과 비용을 보여 주고, 열린 세션 전부를 `/board` 한 화면에(각 세션의 harness·graph·teams 실행과 함께) 보여 주며, main이 바뀌면 같은 저장소의 다른 세션에 알립니다. 버전 `0.4.1`. Claude Code 2.1.292 이상(hooks 모듈)이 필요합니다. 이 마켓플레이스의 다른 것은 필요 없습니다.

## 설치
```
/plugin install session@newkayak12-claude-skills
```

> **trophy 함께 설치.** 이 버전부터 이 플러그인을 설치하거나 업데이트한 뒤 첫 대화형 세션에서, trophy가 없으면 [trophy](../trophy/KOR.md)(업적)를 user 범위로 한 번 설치합니다. 동의하기 전에는 아무것도 보내지 않으며, trophy를 지우면 다시 설치하지 않습니다. 미리 거부하려면: `mkdir -p ~/.claude/plugins/.newkayak12-trophy-ride.done`. `sh`가 필요합니다(sh가 없는 Windows는 해당 없음).

## /session
`/session`은 두 개의 보기가 있는 패널 하나를 엽니다. 버튼 또는 `1` / `2` 키로 전환합니다.
- **Retro `[1]`**: 이 세션에서 Claude가 수정하거나 쓴 파일(`git diff --numstat`의 `+추가 -삭제` 포함), 만든 커밋(해시와 제목), 거부된 도구 호출(도구와 이유), 한 턴 안에서 도구 호출 사이 가장 긴 간격.
- **Orphans `[2]`**: 이 세션 아래에서 아직 실행 중인 `claude -p` 자식 프로세스를 한 줄씩 표시합니다. pid, 명령, 경과 시간, `[stop]`. 백그라운드 셸과 서브에이전트는 `/tasks`를 안내하는 한 줄만 있고, 이 플러그인은 나열하지 않습니다. 변경 내용 전체는 `/diff`로 보세요.

`/session retro`는 Retro 보기를 엽니다. 이 세션에서 아직 아무 일도 없으면 지난 세션이 남긴 요약을 보여 줍니다.

## Retro 밴드
세션이 끝나면 요약이 저장됩니다(`claude -p` 실행도 포함). 다음 인터랙티브 시작 때 프롬프트 위에 한 줄이 나옵니다. `last session: 4 files, 2 commits, 1 denied, longest gap 6m12s`, 그리고 `[Retro]`, `[dismiss]` 버튼. dismiss하면 저장된 요약이 삭제됩니다. 저장소에는 아무것도 쓰지 않습니다.

## 자식 프로세스 안전 중지
`[stop]`은 다음 확인을 거쳐 프로세스 하나에 `SIGTERM` 하나만 보냅니다.
1. 새 프로세스 표를 읽습니다. pid가 여전히 이 세션 프로세스 아래에 있어야 하고, 세션 자신이나 그 조상이면 안 됩니다.
2. 명령과 시작 시각이 방금 본 것과 같아야 합니다(재사용된 pid는 거부).
3. 전체 명령이 보이는 확인 창에서 승인합니다.
4. 신호 직전에 확인을 한 번 더 합니다.

`kill -9`, 프로세스 그룹, 패턴 kill, "전체 중지"는 없습니다. 거부되면 토스트만 보이고 아무것도 보내지 않으며, 이미 끝난 프로세스는 행만 지워집니다.

래퍼 셸과 그 `claude -p` 자식은 한 행으로 보이며, `[stop]`은 안쪽 `claude -p`를 대상으로 합니다.

## 상태줄
플러그인은 상태줄을 하나 씁니다. 자식이 살아 있으면 `⧗ N claude -p child(ren) running`(턴이 끝날 때마다 갱신), 가드가 무언가를 거부하면 그 즉시 `guard: N denied`를 표시하고, 둘 다 해당하면 ` · `로 이어 붙입니다. 둘 다 비었을 때만 지워지며, 헤드리스 실행에서는 아무것도 표시하지 않습니다. `mods`에도 자체 `claude -p` 개수 표시가 남아 있어, 두 플러그인을 함께 설치하면 둘 다 보일 수 있습니다.

![status-line](docs/images/status-line.png)
*가드가 `.env` 쓰기를 거부한 뒤의 상태줄: `guard: 1 denied · $0.11 · seven_day 35%`.*

![orphan-count](docs/images/orphan-count.png)
*백그라운드로 띄운 `claude -p` 자식: `⧗ 1 claude -p child(ren) running`.*

## 가드
Bash 명령이나 Write/Edit가 실행되기 전에 몇 가지 규칙으로 검사해 먼저 묻습니다(모드에 따라 막기만 하기도 합니다). 모든 저장소에서 동작하며 bypass-permissions 세션도 포함합니다.

![guard-ask](docs/images/guard-ask.png)
*`hard-reset` 규칙: `git reset --hard HEAD` 전에 Run / Cancel을 묻습니다.*

![guard-toast](docs/images/guard-toast.png)
*`secret-write` 질문에 Cancel: toast와 모델이 돌려받는 이유.*

### 규칙
| 규칙 | 걸리는 경우 | 기본 |
|---|---|---|
| `recursive-delete` | 재귀+강제 플래그의 `rm`이 `/`, `~`, `$HOME`, 저장소 루트, cwd의 상위, 또는 그 glob을 가리킬 때 | 확인 |
| `force-push-protected` | `main`, `master`, `trunk`, 원격 기본 브랜치, `guard_extra_protected_branches`에 대한 `-f`, `--force`, `--force-with-lease`, `+branch` refspec의 `git push`. 옵션 없는 force push는 현재 브랜치가 보호 대상일 때 해당 | 확인 |
| `hard-reset` | `git reset --hard`, `git clean -f`(`-n` 제외) | 확인 |
| `worktree-dirty-remove` | 커밋 안 된 변경이 있는 워크트리에 `git worktree remove --force` | 차단 |
| `secret-write` | `.env`(`.env.example` 제외), `*.pem`, `*.key`, `id_rsa` 등, `.aws`·`.ssh` 등 아래 자격 증명, 또는 `guard_secret_paths`에 대한 Write/Edit | 확인 |
| `running-script` | 지금 실행 중인 프로세스가 있는 `.sh` 파일에 대한 Write/Edit | 차단 |

명령을 먼저 나눠서 검사하므로 `cd x && rm -rf /`는 잡히고, `grep -r "rm -rf" .`나 `rm -rf node_modules`는 잡히지 않습니다. 해석할 수 없는 명령은 통과합니다.

### 모드
`/config`에서 `guard_mode`를 설정합니다.
- `confirm`(기본): 확인 규칙은 `Run` / `Cancel`을 보여 주고, 차단 규칙은 이유와 함께 거부합니다.
- `deny`: 확인 규칙도 묻지 않고 거부합니다.
- `off`: 아무것도 검사하지 않습니다. 탈출구입니다.

bypass는 네이티브 프롬프트가 없다는 뜻이지 안전망이 없다는 뜻이 아닙니다. bypass에서도 가드는 묻습니다. 헤드리스(`claude -p`)에는 물어볼 사람이 없으므로 모든 규칙을 통과시키고 아무것도 기록하지 않습니다.

### 다루지 않는 것
샌드박스가 아닙니다. `python -c`, `find -delete`, `dd`, 셸 alias, 같은 일을 하는 스크립트는 검사하지 않습니다. 비밀 파일은 경로로만 판단하며 쓰는 내용은 읽지 않습니다.

### 거부 로그
`/session-denials`는 거부된 호출 패널을 엽니다. `[Copy rule]`은 `/permissions`에 넣을 규칙을 보여 줍니다. 항목에는 도구, 가린 호출(토큰, `NAME=value`, URL 비밀번호는 마스킹. 파일 호출은 경로만 저장), 이유, 출처가 들어갑니다. 플러그인 저장소에 최근 200개까지 보관하며 저장소에는 아무것도 쓰지 않습니다. `log_enabled`로 끌 수 있습니다. 가드가 본 네이티브 권한 거부도 기록하지만, 네이티브 대화상자에서 직접 누른 "No"는 기록하지 않습니다.

![denials-pane](docs/images/denials-pane.png)
*`/session-denials`: 거부된 호출 2건. `[Copy rule]`이 `Bash(git reset:*)`를 보여 줍니다.*

## 메모
`/memo`는 다음 프롬프트에 함께 실리는 짧은 메모를 보관해, `/compact`나 `/clear` 뒤에도 모델이 다시 보게 합니다.

### 명령
| 명령 | 동작 |
|---|---|
| `/memo` | 읽기 전용 Memo 패널을 엽니다(모델이 받는 것과 같은 텍스트, 개수, 14일 이상 된 메모의 "CLAUDE.md로 옮길까?" 힌트) |
| `/memo add [--global] <text>` | 메모 추가(기본은 프로젝트) |
| `/memo list` | Memo 패널 열기(headless에서는 메모 출력) |
| `/memo rm <n>` | `list`의 번호 `n` 메모 삭제 |
| `/memo clear [--global]` | 프로젝트 메모 또는 전역 메모 비우기 |

![memo-pane](docs/images/memo-pane.png)
*대화창의 `/memo list` 출력과 전역·프로젝트 메모가 든 Memo 패널.*

### 범위와 한도
범위는 프로젝트(저장소 루트 기준)와 전역 둘입니다. 한도는 둘을 합쳐 셉니다. 메모 8개, 각 280자, 전체 1200자이며 넘으면 이유와 함께 추가를 거부합니다. 주입되는 블록은 고정 머리말 다음에 `[global]`, `[project]` 메모 순입니다. 대화마다 한 번 실리고, `/compact`나 `/clear` 뒤, 또는 내용이 바뀐 뒤 다음 프롬프트부터 다시 실립니다.

CLAUDE.md도 자동 메모리도 아닙니다. 메모는 파일이 아니고, 저장소에 쓰이지 않으며, 공유되지 않습니다. 오래 갈 규칙은 `CLAUDE.md`에, 지금 고정해 두고 싶은 것은 메모에 두세요.

## 스마트 compact
정한 컨텍스트 %에 닿으면 먼저 세션 recap(목표, 결정, 현재 상태, 남은 일, 다음 방향)을 받고, 그 recap을 요약 지시로 넣어 compact합니다. compact 뒤에도 어디로 가던 중이었는지가 남습니다.

| 명령 | 하는 일 |
| --- | --- |
| `/smart-compact` | 현재 임계치(기본 70%), 마지막 점검, 이 프로세스의 집계 출력 |
| `/smart-compact <10-95>` | 임계치 설정. `60`, `60%` 둘 다 됩니다 |
| `/smart-compact log` | 최근 점검 10개를 최신순으로: `23% vs 10% → recapping → compacted` |

같은 값이 `/config`의 **Smart compact threshold (%)** 항목입니다. 메인 루프 턴이 답변으로 끝난 뒤, 인터랙티브 세션에서만 동작하고 서브에이전트에서는 동작하지 않습니다. recap이 실패하면 아무것도 하지 않고 내장 auto-compact에 맡깁니다. auto-compact 지점보다 낮게 잡으세요. 높으면 auto-compact가 먼저 돕니다. %는 상태줄과 같은 모델 전체 창 기준이라, 1M 창에서 70%는 700k 토큰입니다.

인터랙티브 메인 루프 턴을 점검할 때마다 50개짜리 로그(원래 %, 임계치, 판단, 결과)에 남고, `/smart-compact log`가 보여 줍니다. 서브에이전트와 헤드리스 턴은 프로세스 안에서 집계만 하며, `/smart-compact`가 그 집계와 로그 쓰기 오류를 함께 보여 줍니다.

## Recap, handoff, lessons
smart-compact나 `/handoff`가 만든 recap은 프로젝트별로 마지막 하나가 보관됩니다.

| 명령 | 하는 일 |
| --- | --- |
| `/handoff` | 지금 recap을 만들어 보관하고 보드의 Recap 탭으로 열기 |
| `/handoff <session>` | 같은 동작에 더해 그 세션(피어 세션 이름이나 id)으로 전송 |
| `/recap` | 이 프로젝트의 마지막 recap(7일 이내)을 보드의 Recap 탭으로 열기 |
| `/lessons` | recap에서 모은 "두 번 이상 고친 것" 목록(최근 20개)을 보드의 Lessons 탭으로 열기. `/lessons clear`로 비우기 |

headless 실행(`claude -p`)에서는 이 명령들이 텍스트를 출력합니다. 다음 시작 때 밴드에 `last recap of this project, <경과>`와 **Recap** 버튼이 나오고, 누르면 보드의 Recap 탭이 열립니다. lessons는 어디에도 자동으로 쓰지 않습니다. 남길 만한 것은 직접 `CLAUDE.md`로 옮기세요.

![handoff](docs/images/handoff.png)
*`/smart-compact 60` 다음 `/handoff`: 6개 항목 recap을 출력하고 보관합니다.*

## 작업 타이머
`/task <이름>`으로 시작, `/task`로 확인, `/task done`으로 종료, `/task log`로 오늘 이름별 합계를 보드의 Today 탭에서 봅니다(headless에서는 출력). 진행 중에는 상태줄에 `⏱ <이름> 12m`이 1분마다 갱신되고, 새 작업을 시작하면 이전 작업은 끝난 것으로 기록됩니다.

## 비용
턴마다 상태줄에 세션 비용과 가장 높은 rate limit 사용률이 나옵니다(`$1.23 · 5h 42%`). `/config`의 **Cost budget (USD)**를 정하면 그 금액에 닿을 때 toast가 한 번 뜹니다(0이면 끔).

![cost-budget](docs/images/cost-budget.png)
*Cost budget을 $0.01로 둔 경우: 첫 턴 뒤의 toast와 상태줄의 비용.*

## 프롬프트 힌트
기본은 꺼짐입니다(`/config`의 **Prompt hint**). 켜면 20자 이하이면서 작업을 요청하고(fix/add/만들/고쳐…) 경로·코드·검증 기준이 없는 프롬프트에 범위나 검증 기준을 묻는 toast가 10분에 한 번까지 뜹니다. 프롬프트 자체는 바꾸지 않습니다.

![prompt-hint](docs/images/prompt-hint.png)
*Prompt hint 켬: `add logging`에 범위·검증 기준 toast가 뜨고, 프롬프트는 그대로 실행됩니다.*

## 보드
`/board`는 이 플러그인이 있는 열린 인터랙티브 세션 전부를 한 패널에 보여 주는, 플러그인이 아는 것을 보는 기본 화면입니다. 탭은 **Sessions** `[1]`, **Recap** `[2]`, **Lessons** `[3]`, **Today** `[4]`이고 `[r]`로 세션 목록을 새로 고칩니다.

세션 행마다 브랜치, 컨텍스트 %, 비용, 진행 중인 작업, 그리고 그 폴더의 실행 세 칸이 나옵니다. 칸은 각 플러그인 패널의 표현과 표시를 그대로 씁니다: `harness ● running 1/3`, `graph ○ blocked 4/9`, `teams ✔ finished 3/3`, 없으면 `–`. 진행 중인 실행은 그 세션에서 자세히 볼 명령(`/harness-gate`, `/graph-live`, `/teams-live`)을 함께 보여 줍니다. 보드는 실행 파일을 직접 읽으므로 그 플러그인들이 없어도 됩니다.

세션은 시작할 때와 턴마다 자기 행을 쓰고, 끝날 때 지웁니다. 30분 동안 갱신되지 않은 행은 idle로, 하루가 지난 행은 버립니다. 행은 이 컴퓨터의 플러그인 저장소에만 있습니다.

## main 변경 알림
한 세션에서 `main`으로의 `git push`가 성공하면(`origin main`, `HEAD:main`, `x:main`, main 브랜치에서의 그냥 push), 같은 저장소에서 최근 30분 안에 움직인 다른 열린 세션마다 `origin/main moved to <sha> … Fetch before editing or bumping versions.` 메시지가 갑니다. 세션당 2분에 한 번까지이고, 이 세션에는 `main moved: told N of M` toast가 뜹니다. headless 실행은 보내지 않습니다.

## 한계
- "longest gap"은 한 턴 안에서 두 도구 호출 사이 가장 긴 시간이며, 측정된 단계 시간이 아닙니다.
- 거부 횟수는 이 플러그인이 도구 호출 결과로 본 거부만 셉니다.
- 경로는 일반 텍스트입니다(클릭 링크 없음).
- Windows: 고아 프로세스 영역은 숨겨지고 중지는 꺼집니다. Retro 보기와 밴드는 동작합니다.
- 보드의 harness 칸은 통과한 subgoal 수를 spec과 실행 폴더의 subgoal 수와 비교해 셉니다. 전체 단계 보기는 `/harness-gate`에 있습니다.
- UI는 인터랙티브 세션 전용입니다. 헤드리스 실행은 기록과 요약 저장만 하고 아무것도 그리지 않습니다.
- 실제 터미널 세션(2.1.294)에서 확인했습니다. 패널, `[stop]`, 회고 밴드, auto·bypass 모드의 가드 확인, `/clear` 뒤 `/memo`. 데스크톱 Code 탭은 아직 확인하지 않았습니다.
