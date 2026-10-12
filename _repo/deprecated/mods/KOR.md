# mods — 은퇴

[English](README.md) · **한국어**

`mods`는 은퇴했습니다. 기능은 다른 곳으로 옮겼으니 제거하세요.

```bash
/plugin uninstall mods@newkayak12-claude-skills
```

0.3.0은 모듈을 로드하지 않고 아무 일도 하지 않습니다. 단, 이 마켓플레이스의 모든 플러그인이 가진 첫 세션의 [trophy](../trophy/KOR.md) 설치는 그대로입니다(거부: `mkdir -p ~/.claude/plugins/.newkayak12-trophy-ride.done`).

## 기능별 이동처

| # | 기능 | 이동처 |
|---|---|---|
| 1 | 스킬 토스트 | [trophy](../trophy/KOR.md): Skill 호출마다 `◆ <plugin:skill>` 토스트 하나, 그 호출로 업적이 해금되면 생략 |
| 2 | Agent 모델 가드 | [session](../session/KOR.md), 옵션 `agent_model_guard`(기본 `toast`) |
| 3, 4 | 실행 중 스크립트 가드, 워크트리 가드 | [session](../session/KOR.md) 가드 |
| 5, 6, 7 | fetch 알림, push/범프 확인, KOR 없는 README | 이 저장소 전용: `.claude/hooks/repo-rules.mjs`(`.claude/settings.json`의 command 훅). 확인은 사람이 붙은 세션에서만 |
| 8 | 끝나지 않은 에이전트 수 | [session](../session/KOR.md) 상태줄 |
| 9 | `/reap` | [session](../session/KOR.md) |

## 상태 로그

- 0.3.0 — 은퇴: function hook 모듈 없음. 기능은 session, trophy, 저장소 자체 훅으로 이동. 설계: `_repo/docs/plans/2026-10-12-mods-retire-design.md`.
