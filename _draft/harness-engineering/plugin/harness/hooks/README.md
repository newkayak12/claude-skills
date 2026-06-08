# Harness Plugin — Hooks

> Böckeler 프레임워크의 **Sensor** (행동 후 관측·차단) 를 Claude Code hook 으로 구현한다.
> `scripts/` 가 *호출되어야* 작동하는 반면, hook 은 *호출 없이* 자동 발동한다.

## 현재 구현 (Computational Sensor)

### `hypothesis-immutability.py` — PreToolUse

| | |
|---|---|
| **이벤트** | `PreToolUse` (matcher: `Edit\|Write\|MultiEdit\|NotebookEdit`) |
| **역할** | `hypotheses.jsonl`·`bar.jsonl`·`review.jsonl`·`phase.jsonl` 직접 편집 시도를 **차단** (exit 2) |
| **막는 것** | 위 append-only chain 직접 편집 차단 (AP-06 Gate fudging + #006 바 낮추기 + #007 리뷰 위조 + **H1 phase 전환 위조**) |
| **정당 경로** | `scripts/hypothesis-register.py` / `bar-register.py` / `review-register.py` / `phase-advance.py` (append + hash chain) 는 막지 않음 |
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

### `phase-guard.py` — PreToolUse

| | |
|---|---|
| **이벤트** | `PreToolUse` (matcher: `Edit\|Write\|MultiEdit\|NotebookEdit`) |
| **역할** | active 사이클이 없거나 (검증된 `phase.jsonl` chain 기준) `current_phase` ∉ {implementation,validation} 이거나 pre-code 게이트 evidence/confirm이 미충족인데 *코드 파일*(.py/.kt/.js/… 소스 확장자) 편집/생성 시도 → **차단**(exit 2). 체인 손상/위조 시 코드·tech-doc 전면 차단 |
| **막는 것** | 하네스 밖 코드 작업 + R-PG01 "No code before design" 위반 — cycle/phase 전진 없이 코드부터 써버리는 속도 우선 행동. rule-inject 가 R-PG01 을 *주입*해도 모델이 어긴다(실사용 피드백) → 차단성 hook 으로 *물리 게이트*화 (주입≠강제, 원칙2) |
| **통과** | 비코드(.md 분석노트·설계문서·ADR·.json/.yaml 설정) / implementation·validation phase → exit 0. 분석·설계문서 작성을 막지 않음 |
| **마찰 기록** | 차단 시 `feedbacklib` 로 `.claude/.feedback/feedback.jsonl` 에 이벤트 기록(beta report 원료). 기록 실패해도 차단 exit2 불변(fail-soft) |
| **정당 경로** | phase 전진은 `scripts/phase-advance.py`(인접 순서 + evidence + collaborative `--confirm-user`+`--confirmation-note`(H2) 강제, --force=blackbox). 전진은 `phase.jsonl` hash-chain 에 기록되고 hook 은 *이 체인*을 권위 소스로 재검증한다 |
| **신뢰 앵커(H1)** | phase-guard 는 metrics.json 이 아니라 tamper-evident `phase.jsonl` chain 에서 phase·게이트를 도출 → **metrics.json `current_phase`/`phase_gates` 직접편집 위조로는 게이트 우회 불가**(이전 #013b H3 한계 해소). 체인 직접편집은 immutability(Edit)+verify_chain(Bash)+부재→차단(삭제)이 방어 |
| **정직한 한계** | bars·hypotheses 와 동일: Bash 로 *유효 해시 체인을 통째로 위조*하는 결정형 공격까지는 못 막음(솔로-dev 위협모델 밖). Bash 파일생성은 흔한 패턴(`>`,`tee`,`touch`,`cp`,`mv`,`sed -i`)만 잡는다 |
| **fail-open / 차단** | 비코드 타깃·stdin JSON 파싱 실패 → exit 0(도구 안 막음). active 없음·체인 손상·pre-code 게이트 미충족 + 코드/tech-doc → 차단(exit 2) |

→ `hypothesis-immutability`(데이터)·`active-symlink-guard`(종료)에 이어 *단계 순서*를 물리로 못박는 세 번째 차단성 Sensor. `phase-advance.py`(산출물 evidence + 사용자 확인 게이트) + `phase-guard`(implementation 전 코드 차단) 가 *짝* (#013b).

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
| **역할** | active 사이클의 `metrics.json:session_count` 를 새 세션마다 +1 (사이클 경과 *작업 세션* 계측) |
| **왜** | 솔로 개발자 단위는 *달력 시간*이 아니라 *작업 세션*. wall-clock 은 사이클 방치 시 오탐("시간 200%")하지만 세션 수는 안 함 (cycle-004) |
| **차단 아님** | metrics 갱신만. exit 0. metrics.json 은 hypothesis-immutability 보호 대상 아님(보호는 `hypotheses/bar/review/phase.jsonl` chain 4종) → 자유 갱신. 단 phase 권위 SSOT 는 metrics 가 아니라 보호되는 `phase.jsonl`(H1)이라 metrics 자유갱신이 게이트를 흔들지 못함 |
| **fail-open** | active 없음/source 미카운트/깨진 metrics → 조용히 통과 |

→ 원래 `kill-check.py` 의 시간 지표를 *관측 가능*하게 만든 계기(cycle-004)였으나, **#015 에서 kill-check
계열이 은퇴**(발화 0)하면서 `session_count` 의 자동 소비자는 사라졌다 — 현재는 retro·진단용 *계측치*로만
남는다. budget$ 는 *관측 불가* → 애초에 드롭됨. "측정 가능한 것만 강제한다"(역으로: 측정만 하고 강제
않는 지표는 비용 — session_count 자체의 은퇴 여부는 후속 검토, metrics SPOF rank4 와 교차).

### `rule-inject.py` — SessionStart

| | |
|---|---|
| **이벤트** | `SessionStart` |
| **역할** | `rules-merge effective --dynamic`(invariant L0 + L1 user-rules)를 **컨텍스트에 자동 주입** — 사람이 수동으로 `rules-merge` 실행 없이 세션마다 항상-켜둘 룰이 도달 |
| **주입 범위** | invariant(R-PG·R-DoD·R-DD·R-AI 등) + L1 override. 정적 default(R-CD 코딩 룰) 제외(stage-inject 가 커버) |
| **압축** | 1줄/룰 lossless 포맷 (766토큰→384 기준; `_layer:` 오버헤드 제거) |
| **주입 ≠ 강제** | soft 안내(원칙1 "지도"). 진짜 강제는 게이트·차단성 PreToolUse hook (원칙2) |
| **fail-open** | HARNESS_HOME 부재·rules-merge 실패·effective 0 → exit 0, 무스팸 |

→ `stage-inject`(PreToolUse, 코딩 단계 룰)와 *짝*: 자동주입을 두 시점으로 나눠 세션시작 토큰 ↓ AND 방어를 경계→플로우 내부로 확장 (#012).

> **은퇴됨 (#015, 2026-06-06)**: `deploy-kill-check.py`(UserPromptSubmit 배포차단)와 그 엔진
> `kill-check.py` 를 함께 은퇴했다. 사유: 실사용 **발화 0 · 효과 최약**(roadmap rank6)에 더해
> deploy-kill-check→kill-check→metrics 의 **3단 의존**이 mechanism-count 부채만 키웠다(ADR-0001
> standing 부채). 은퇴로 count 28→26, ratchet floor 27→26 단조 개선. C-06 Sunk-cost 방어는
> 이제 narrative(retro 의 kill 사유 서술)로 남는다 — *측정 가능한 것만 강제한다* 원칙상, 발화 0 의
> Sensor 는 강제가 아니라 비용이었다.

→ 현재 **2 이벤트 Sensor**: PreToolUse(가설/WIP/phase/stage 차단) · SessionStart(탐지+세션 측정+룰주입). 이벤트 성격이 차단 권한을 정함 (PreToolUse=차단 가능, SessionStart=경고만).

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

> `deploy kill-check` 는 후보(스펙)→#005 구현→**#015 은퇴**의 전 생애를 거쳤다. 발화 0·효과 최약 +
> 3단 의존 부채로 은퇴(위 은퇴 노트 참조). 교훈: Sensor 를 *구현*했다고 효과가 보장되지 않는다 —
> 실발화로 검증 안 되면 mechanism-count 부채만 남는다(CA-11/PF-11 "빼기 없는 더하기"의 반례 회수).

- 컨셉 카탈로그(spec): `../../../hooks/README.md` (16개 hook 설계, 대부분 미구현).
- `rule-inject`(SessionStart, 항상-켜둘 룰)·`stage-inject`(PreToolUse, 단계별 룰) — 자동주입 2시점.
  카탈로그엔 없던 신규(#012 rule-auto-injection + stage-injection 후속). 위 "현재 구현" 섹션에 수록(rule-inject 는 별도 Sensor 섹션, stage-inject 는 위 PreToolUse 블록).
