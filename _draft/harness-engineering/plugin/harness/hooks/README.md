# Harness Plugin — Hooks

> Böckeler 프레임워크의 **Sensor** (행동 후 관측·차단) 를 Claude Code hook 으로 구현한다.
> `scripts/` 가 *호출되어야* 작동하는 반면, hook 은 *호출 없이* 자동 발동한다.

## 현재 구현 (Computational Sensor)

### `hypothesis-immutability.py` — PreToolUse

| | |
|---|---|
| **이벤트** | `PreToolUse` (matcher: `Edit\|Write\|MultiEdit\|NotebookEdit`) |
| **역할** | `hypotheses.jsonl`·`bar.jsonl`·`review.jsonl` 직접 편집 시도를 **차단** (exit 2) |
| **막는 것** | `hypotheses.jsonl`·`bar.jsonl`·`review.jsonl` 직접 편집 차단 (AP-06 Gate fudging + #006 바 낮추기 + #007 리뷰 위조) |
| **정당 경로** | `scripts/hypothesis-register.py` / `scripts/bar-register.py` / `scripts/review-register.py` (append + hash chain) 는 막지 않음 |
| **fail-open** | 입력 JSON 파싱 실패 시 *통과* — hook 이 정당한 작업을 막지 않도록 |

이것이 `13-operational-layer.md §3·§4` 의 *"코드로 강제 (Computational)"* 의 첫 실제 wiring 이다.
`CV-1`(author=enforcer=target)을 *narrative* 가 아니라 *물리적*으로 방어한다.

### `stage-inject.py` — PreToolUse

| | |
|---|---|
| **이벤트** | `PreToolUse` (matcher: `Edit\|Write\|MultiEdit\|NotebookEdit`) — 코드 작성 시작 = `code-writing` 단계 진입 |
| **역할** | 단계 진입 순간 그 단계 룰(`rules-merge effective --stage code-writing` = R-CD 코딩 룰 등)을 **컨텍스트 주입** |
| **주입 방법** | stdout JSON `hookSpecificOutput.additionalContext` (+ `permissionDecision: allow`). PreToolUse 의 plain stdout 은 모델에 안 보이므로 JSON 이 *유일한* 주입 경로(공식 docs 확인). additionalContext 는 *도구 결과 옆*(=도구 호출 시점)에 주입됨 |
| **메우는 것** | CA-10 (review/2026-06-03): rule-inject(SessionStart)는 *경계*에서만 1회 쏨 → 긴 플로우 중간 스크롤아웃·compaction 으로 룰 소실. 이 hook 이 방어를 *플로우 내부*로 확장 — 코딩이 *실제 시작될 때* 코딩 룰 재도달 |
| **기능 보존** | rule-inject 가 `--dynamic`(invariant+L1)로 슬림해질 수 있는 근거. 빠진 정적 default(R-CD 등)를 이 hook 이 단계에서 재주입 → 모든 코딩 룰이 여전히 모델에 도달 |
| **de-dup** | 세션·단계당 1회. 마커 `$HARNESS_HOME/stage-inject/<sid>/code-writing.injected`. 마커 있으면 plain allow(무주입) — 매 Edit 스팸 방지 |
| **차단 아님** | `permissionDecision=allow` — 도구를 막지 않음. *주입 ≠ 강제*(원칙1, rule-inject 와 동일 경계) |
| **fail-open** | 머지 엔진 부재 / effective 0 / JSON 파싱 실패 / 마커 IO 실패 → 무주입 plain allow, 도구 막지 않음 |

→ rule-inject(SessionStart, 항상-켜둘 invariant+L1) + stage-inject(단계 진입, 단계별 정적 default) 가 *짝*: 자동주입을 *두 시점*으로 나눠 세션시작 토큰 ↓ AND 방어를 경계→플로우 내부로 확장 (#012 후속, PF-10).

### `active-symlink-guard.py` — PreToolUse

| | |
|---|---|
| **이벤트** | `PreToolUse` (matcher: `Bash`) |
| **역할** | `cycles/active` symlink 를 Bash 로 직접 제거(`rm`/`unlink`)하려는 시도를 **차단** (exit 2) |
| **막는 것** | 수동 `rm cycles/active` 로 품질 게이트를 우회하는 종료 (#007 Full Computational) |
| **정당 경로** | `scripts/close-cycle.py` — 게이트(모든 바 기준에 잠긴 hash 결박 pass 리뷰) 통과 시 *in-process* 로 unlink 하므로 이 hook 대상 아님 |
| **대칭** | `hypothesis-immutability` 가 *데이터*(바·리뷰)를 보호하듯, 이 hook 은 *종료 행위*(symlink 제거)를 정당 스크립트로만 강제 |
| **정직한 한계** | Bash 의 `rm`/`unlink` 만, `cycles/active` *그 자체*(하위 경로 아님)만. `mv`·python `os.unlink`·`find -delete`·후행 슬래시는 못 잡음 |
| **fail-open** | non-Bash 도구 / JSON 파싱 실패 → 통과 |

→ `close-cycle.py`(게이트 내장 종료) + `active-symlink-guard`(수동 우회 차단) 가 *짝*: 종료의 유일 정당 경로를 코드로 못박는다 (#007 ②).

### `active-cycle-verify.py` — SessionStart

| | |
|---|---|
| **이벤트** | `SessionStart` |
| **역할** | active 사이클의 가설·바·리뷰 chain 을 verify → 변조 탐지 시 **경고**(stdout=컨텍스트 주입) (#007 F5: bar·review 확장) |
| **메우는 것** | PreToolUse 의 사각 — *세션 밖*(에디터 직접) 편집은 도구 호출이 아니라 못 막음. 다음 세션 시작 시 *탐지*로 보강 (cycle-002 F2) |
| **차단 아님** | SessionStart 는 차단 개념이 없음. intact→짧은 확인, tampered→경고. 둘 다 exit 0 (세션 막지 않음) |
| **fail-open** | active 없음/스크립트 못 찾음 → 조용히 통과 |

→ 두 Sensor 가 *짝*: PreToolUse(세션 내 차단) + SessionStart(세션 밖 탐지). 하나로 완전하지 않다 (cycle-002 retro 교훈).

### `session-counter.py` — SessionStart

| | |
|---|---|
| **이벤트** | `SessionStart` (source `startup` 만 카운트 — resume/compact/clear 는 연속 세션, 미증가) |
| **역할** | active 사이클의 `metrics.json:session_count` 를 새 세션마다 +1 → kill-check 시간 지표를 *관측 가능*하게 |
| **왜** | 솔로 개발자 단위는 *달력 시간*이 아니라 *작업 세션*. wall-clock 은 사이클 방치 시 오탐("시간 200%")하지만 세션 수는 안 함 (cycle-004) |
| **차단 아님** | metrics 갱신만. exit 0. metrics.json 은 hypothesis-immutability 보호 대상 아님(그 hook 은 hypotheses.jsonl·bar.jsonl 만) → 자유 갱신 |
| **fail-open** | active 없음/source 미카운트/깨진 metrics → 조용히 통과 |

→ 이것으로 `kill-check.py` 가 *항상-0(거짓 OK)* 없이 실제 데이터로 판정 가능 (cycle-004). budget$ 는 *관측 불가* → kill 지표에서 드롭. "측정 가능한 것만 강제한다".

### `deploy-kill-check.py` — UserPromptSubmit

| | |
|---|---|
| **이벤트** | `UserPromptSubmit` (deploy 키워드: 배포/출시/릴리즈/deploy/release/ship it/go live/프로덕션) |
| **역할** | 배포 의도 표명 시 active 사이클에 `kill-check.py` 실행 → **Hard kill이면 배포 프롬프트 차단**(exit 2) |
| **막는 것** | C-06 Sunk-cost / AP-10 — *죽었어야 할 사이클*을 배포로 밀어붙이기 |
| **매핑** | kill-check 0(ok)→통과 · 1(soft)→경고만(차단 아님, 재평가는 사람) · 2(hard)→exit2 차단 · 3(err)→fail-open |
| **선행** | cycle-004 의 metrics 정직화(session_count 자동)가 있어야 실데이터 판정 — 없으면 항상-ok 거짓 통과 |
| **fail-open** | deploy 키워드 없음/active 없음/스크립트 못 찾음/JSON 실패 → 통과 |

→ 이제 **3 이벤트 Sensor**: PreToolUse(가설 차단) · SessionStart(탐지+세션 측정) · UserPromptSubmit(배포 차단). 이벤트 성격이 차단 권한을 정함 (PreToolUse·UserPromptSubmit=차단 가능, SessionStart=경고만).

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
# bar.jsonl 도 차단 기대 (exit 2)
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/bar.jsonl"}}' \
  | python3 hooks/hypothesis-immutability.py; echo $?
# review.jsonl 도 차단 기대 (exit 2)
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/review.jsonl"}}' \
  | python3 hooks/hypothesis-immutability.py; echo $?
# 통과 기대 (exit 0)
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/cycle-card.md"}}' \
  | python3 hooks/hypothesis-immutability.py; echo $?
# active-symlink-guard: rm cycles/active 차단 기대 (exit 2)
echo '{"tool_name":"Bash","tool_input":{"command":"rm cycles/active"}}' \
  | python3 hooks/active-symlink-guard.py; echo $?
```

## 백로그 (다음 Sensor 후보)

> `deploy kill-check` 는 이전에 여기 *후보*로 남아 있었으나 #005 에서 *구현됐다*(위 `deploy-kill-check.py`
> 참조). #011 entropy-gc GP-4(의미적 stale) 검토에서 정정 — 구현된 항목이 '후보'로 남는 건 역방향 stale.

- 컨셉 카탈로그(spec): `../../../hooks/README.md` (16개 hook 설계, 대부분 미구현).
- `rule-inject`(SessionStart, 항상-켜둘 룰)·`stage-inject`(PreToolUse, 단계별 룰) — 자동주입 2시점.
  카탈로그엔 없던 신규(#012 rule-auto-injection + stage-injection 후속). 위 "현재 구현" 섹션에 수록(rule-inject 는 별도 Sensor 섹션, stage-inject 는 위 PreToolUse 블록).
