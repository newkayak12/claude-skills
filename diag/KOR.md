# diag (beta)

이 마켓플레이스 스킬과 MCP 도구의 실패를 대화형 세션에서 기록하고, `/diag` 패널로 보여주며, trophy 텔레메트리 동의(v2)가 yes일 때만 고정 오류 코드와 횟수를 전송합니다. 베타: 버전 `0.1.0-beta.1`. Claude Code 2.1.292 이상 필요 (hooks 모듈, 대화형 세션만).

## Install
```
/plugin install diag@newkayak12-claude-skills
```

## What is collected automatically (local only)
이벤트는 내 컴퓨터의 플러그인 저장소에만 보관됩니다 (최근 500개; 같은 reason + skill/tool + 세션이 5초 안에 반복되면 한 번으로 셉니다):
- 소유 스킬 로드 실패 또는 unsuccessful 결과 (fork 스킬 포함)
- 소유 MCP 도구 호출 실패 (`mcp_error`); 중단(interrupt)은 사용자의 행동이라 버그로 세지 않습니다
- 하네스 실행 결과 (subgoal 또는 goal 게이트 실패)
- `/diag bug <note>` 신고

"소유"는 이 마켓플레이스 플러그인의 스킬/도구를 뜻하며, 이름만 있는 스킬은 소유로 보지 않습니다. 원문 오류 텍스트와 메모는 로컬에만 남습니다.

## /diag
- `/diag`: 로컬 실패 목록과 상세, 전송 켜짐/꺼짐 상태를 보여주는 패널을 엽니다.
- `/diag bug <note>`: 신고를 기록합니다. 메모는 로컬에만 남고, 고정 코드 `user_report`만 전송될 수 있습니다.

## What is sent
trophy 동의가 **동의 문구 버전 2에서 yes**일 때만 전송합니다 (v1 yes는 한 번 다시 묻고, no는 다시 묻지 않음). 세션당 한 번, 첫 메인 턴에서 아직 보내지 않은 날(어제까지, UTC)을 PostHog `https://us.i.posthog.com/batch/`로 보냅니다. 날짜·reason·plugin·skill/tool별 이벤트 하나에 `count`를 담습니다:

| Event | Properties |
|---|---|
| `diag_skill_error` | `skill`, `plugin`, `reason` (`is_error`, `unsuccessful`, `forked_unsuccessful`), `count`, `day` |
| `diag_mcp_error` | `tool` (MCP 도구 이름), `plugin`, `reason` (`mcp_error`), `count`, `day` |
| `diag_user_report` | `reason` (`user_report`), `count`, `day`, 알 수 있으면 `skill`, `plugin` |
| `diag_hook_error` | 예약: 정의만 있고 이 버전은 보내지 않음 |

각 이벤트에는 `timestamp`(해당 날짜 12:00 UTC)와 `$process_person_profile: false`도 들어갑니다. 모든 이벤트에는 무작위 install id (첫 실행 때 생성, 사용자나 기기에서 유도하지 않음)가 함께 갑니다. 동의 후 첫 전송은 어제만이 아니라 그 이전의 로컬 날짜도 포함합니다 (코드만). 실패한 전송은 보관했다가 다음 세션에서 다시 시도합니다. 전송 본문은 패널 미리보기와 정확히 같습니다.

연결 참고: diag는 trophy와 같은 PostHog 프로젝트로 보냅니다. install id는 trophy와 별개지만, 같은 기기의 diag·trophy 이벤트는 서버에서 (날짜와 skill/plugin 이름으로) 서로 맞춰질 수 있습니다. 어느 쪽에도 사용자를 식별하는 정보는 없습니다.

## What is never sent
로컬 오류 텍스트, `/diag bug` 메모, 파일 경로, 실행 slug, subgoal 이름, 세션 id, 하네스 결과(subgoal/goal), 프롬프트, 작업 디렉터리, 프로젝트·파일 이름, 사용자 이름·이메일.

## Turning it off
`/trophy-telemetry off`는 trophy와 diag의 전송을 모두 멈춥니다. trophy가 없으면 diag는 전송하지 않습니다.

참고: 비대화형 세션에서 `/trophy-telemetry status`가 v2 yes를 "v1 yes"로 표시할 수 있습니다. 저장된 동의 값은 그대로입니다.

## Pending live checks (L1-L7)
아직 실제 세션에서 확인하지 않았습니다:
- L1 실패한 Skill 호출이 `PostToolUseFailure`를 일으킴 (더 앞에서 거부될 수 있어 로드 실패만 확실)
- L2 서브에이전트 `Write`가 부모 모듈의 `tool.call`을 일으킴
- L3 Bash `tool.call` 결과가 `COMPLETE ... goal-gate FAIL` 줄의 `stdout`을 노출함
- L4 `--plugin-dir`과 설치본에서 마켓플레이스 후보가 해석되고 MCP 서버 이름을 읽을 수 있음
- L5 `/diag`가 가려지지 않고 등록됨
- L6 diag가 trophy 동의를 실시간으로 읽음 (trophy 없으면 `undefined`)
- L7 PostHog 프로젝트에 대한 실제 리포트 쿼리

## Maintainer
`POSTHOG_PERSONAL_KEY=<key> node _repo/scripts/diag-report.mjs [--days 30]`는 `diag_*` 이벤트를 고유 install 수, 그다음 횟수 순으로 정렬합니다.
