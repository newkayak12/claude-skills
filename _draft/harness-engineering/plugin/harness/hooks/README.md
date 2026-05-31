# Harness Plugin — Hooks

> Böckeler 프레임워크의 **Sensor** (행동 후 관측·차단) 를 Claude Code hook 으로 구현한다.
> `scripts/` 가 *호출되어야* 작동하는 반면, hook 은 *호출 없이* 자동 발동한다.

## 현재 구현 (Computational Sensor)

### `hypothesis-immutability.py` — PreToolUse

| | |
|---|---|
| **이벤트** | `PreToolUse` (matcher: `Edit\|Write\|MultiEdit\|NotebookEdit`) |
| **역할** | `hypotheses.jsonl` 직접 편집 시도를 **차단** (exit 2) |
| **막는 것** | `AP-06` Gate fudging — 등록된 가설을 사후에 손으로 고쳐 검증을 통과시키기 |
| **정당 경로** | `scripts/hypothesis-register.py register` (append + hash chain) 는 막지 않음 |
| **fail-open** | 입력 JSON 파싱 실패 시 *통과* — hook 이 정당한 작업을 막지 않도록 |

이것이 `13-operational-layer.md §3·§4` 의 *"코드로 강제 (Computational)"* 의 첫 실제 wiring 이다.
`CV-1`(author=enforcer=target)을 *narrative* 가 아니라 *물리적*으로 방어한다.

### `active-cycle-verify.py` — SessionStart

| | |
|---|---|
| **이벤트** | `SessionStart` |
| **역할** | active 사이클의 가설 chain 을 verify → 변조 탐지 시 **경고**(stdout=컨텍스트 주입) |
| **메우는 것** | PreToolUse 의 사각 — *세션 밖*(에디터 직접) 편집은 도구 호출이 아니라 못 막음. 다음 세션 시작 시 *탐지*로 보강 (cycle-002 F2) |
| **차단 아님** | SessionStart 는 차단 개념이 없음. intact→짧은 확인, tampered→경고. 둘 다 exit 0 (세션 막지 않음) |
| **fail-open** | active 없음/스크립트 못 찾음 → 조용히 통과 |

→ 두 Sensor 가 *짝*: PreToolUse(세션 내 차단) + SessionStart(세션 밖 탐지). 하나로 완전하지 않다 (cycle-002 retro 교훈).

## Wiring

플러그인은 [`hooks.json`](./hooks.json) 으로 위 hook 을 선언한다. 플러그인 설치 시 Claude Code 가
이를 병합한다. 수동 설정이 필요하면 `settings.json` 에 동일 블록을 추가:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [ { "type": "command",
                     "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/hypothesis-immutability.py" } ] }
    ]
  }
}
```

## Self-test

```bash
# 차단 기대 (exit 2)
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/hypotheses.jsonl"}}' \
  | python3 hooks/hypothesis-immutability.py; echo $?
# 통과 기대 (exit 0)
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/cycle-card.md"}}' \
  | python3 hooks/hypothesis-immutability.py; echo $?
```

## 백로그 (다음 Sensor 후보)

- **deploy kill-check** — 배포 시점 `kill-check.py` exit 2 면 차단 (metrics 자동 갱신 선행 필요).
- 컨셉 카탈로그(spec): `../../../hooks/README.md` (16개 hook 설계, 대부분 미구현).
