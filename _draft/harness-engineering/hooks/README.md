# Hooks — Harness 자동화 게이트

> *Claude Code hooks*를 사용해 harness 룰을 *세션 흐름*에 박는다.
> 룰은 사람이 읽어야 효과가 있지만, *읽지 않는 상황에서도 작동*해야 진짜 게이트.

## 왜 hooks가 필요한가

`scripts/`의 도구는 *호출되어야* 작동. Hooks는 *호출 없이* 작동.

- `hypothesis-register.py`는 사용자가 직접 실행해야 함 → 잊으면 무력
- Hook은 특정 *사건*에 자동 발동 → 잊어도 작동

→ Scripts와 hooks는 *짝*. Script가 도구라면 hook은 도구를 *맥락에 박는* 접착제.

## Claude Code Hook 이벤트 (참조)

| 이벤트 | 발화 시점 | 사용 가능한 매처 |
|---|---|---|
| `SessionStart` | 세션 시작 | (없음) |
| `SessionEnd` | 세션 종료 | (없음) |
| `UserPromptSubmit` | 사용자 입력 제출 시 | (없음) |
| `PreToolUse` | 도구 호출 직전 (차단 가능) | tool_name, tool_input |
| `PostToolUse` | 도구 실행 후 | tool_name, tool_input, tool_output |
| `Stop` | 메인 에이전트 종료 | (없음) |
| `SubagentStop` | 서브에이전트 종료 | (없음) |
| `PreCompact` | 컨텍스트 압축 직전 | (없음) |
| `Notification` | 알림 발생 | (없음) |

Hook 출력 규칙:
- exit 0 + stdout → context 주입 (`UserPromptSubmit`, `SessionStart`)
- exit ≠ 0 on `PreToolUse` → 도구 차단
- JSON `{"decision": "block", "reason": "..."}` → 명시적 차단 + 사유

## Hook 카탈로그

### A. 사이클 인식 (Cycle Awareness)

#### `hook-cycle-context` — 현재 사이클 컨텍스트 주입
- **이벤트**: `SessionStart`
- **트리거**: 매 세션 시작
- **역할**: `cycles/active`가 있으면 cycle-card.md 요약 + 현재 단계 + 핵심 가설 + Kill 임계값을 context로 주입
- **명령**: `bash hooks/cycle-context.sh`
- **의도**: 세션마다 "내가 지금 어느 사이클의 어느 단계인지" 망각 방지
- **관련**: SD-07, AP-09 Cycle chaining

#### `hook-stage-rules` — 단계별 룰 자동 로드
- **이벤트**: `UserPromptSubmit`
- **트리거**: 사용자 prompt에 단계 키워드 (`persona`, `srs`, `architecture`, `stack`, `db`, `deploy`, `launch`)
- **역할**: 키워드 매칭 → `rules-load.py <stage>` 결과를 context로 주입
- **명령**: `bash hooks/stage-rules.sh`
- **의도**: 단계별 룰 *자발적 호출*을 자동화. 인지 부하 감소.
- **관련**: 06-rules.md Stage tag

---

### B. Anti-pattern 감지 (Detection)

#### `hook-solution-shopping` — AP-15 감지
- **이벤트**: `UserPromptSubmit`
- **트리거**: prompt 정규식
  - `~로 만들고 싶`
  - `~ 써보(고|자|면)`
  - `(React|Next|Spring|Kafka|...)로`
- **역할**: AP-15 Solution-shopping 경고 주입 + "문제 진술부터 다시" prompt
- **명령**: `python3 hooks/detect-solution-shopping.py`
- **관련**: 11 AP-15, 09 §9.5

#### `hook-ship-paralysis` — AP-20 감지
- **이벤트**: `UserPromptSubmit`
- **트리거**: prompt 정규식
  - `조금만 더 다듬`
  - `완성 후에`
  - `출시 미루`
- **역할**: SD-04 80% ship rule + SD-08 출시 미루기 이유 점검 reminder
- **명령**: `python3 hooks/detect-ship-paralysis.py`
- **관련**: 11 AP-20, SD-04, SD-08

#### `hook-rule-exemption` — AP-21 감지
- **이벤트**: `UserPromptSubmit`
- **트리거**: prompt 정규식
  - `우리 경우는 다르`
  - `이건 예외`
  - `우리만의`
- **역할**: SD-11 "나는 다르다" 점검 + C-11 Outside view 호출 권장
- **명령**: `python3 hooks/detect-rule-exemption.py`
- **관련**: 11 AP-21, SD-11, C-11

#### `hook-discovery-escape` — AP-19 감지
- **이벤트**: `PostToolUse` (matcher: `Write|Edit`)
- **트리거**: 코드 파일 (`.py`, `.ts`, `.go`, `.kt`, ...) 작성 시 카운터 증가, 인터뷰 노트 작성과 비율 비교
- **역할**: 코드:인터뷰 시간 비율 > 3:1이면 SD-06 자기 점검 reminder
- **명령**: `python3 hooks/discovery-ratio.py`
- **관련**: 11 AP-19, SD-06

---

### C. Gate 보호 (Enforcement)

#### `hook-hypothesis-immutability` — 가설 직접 편집 차단
- **이벤트**: `PreToolUse` (matcher: `Edit|Write`)
- **트리거**: `tool_input.file_path`가 `*hypotheses.jsonl`로 끝남
- **역할**: 직접 편집 차단. `hypothesis-register.py register`로 *새 항목*만 추가 허용. exit ≠ 0.
- **명령**: `bash hooks/block-hypotheses-edit.sh`
- **의도**: AP-06 Gate fudging의 *물리적* 방지선
- **관련**: 08 §8.4, 11 AP-06

#### `hook-adr-immutability` — Accepted ADR 편집 차단
- **이벤트**: `PreToolUse` (matcher: `Edit`)
- **트리거**: `tool_input.file_path`가 `*adr*.md` AND 파일 내 `Status:.*Accepted` 패턴
- **역할**: 차단 + "Superseded-by 링크로 새 ADR 작성" 안내
- **명령**: `python3 hooks/block-accepted-adr.py`
- **의도**: ADR 불변 규칙 강제 (templates/adr.md Rules)
- **관련**: 11 AP-08 Stale ADR

#### `hook-deploy-kill-check` — 배포 전 kill 점검
- **이벤트**: `PreToolUse` (matcher: `Bash`)
- **트리거**: `tool_input.command`에 `deploy`, `release`, `git push.*main`, `npm publish` 등
- **역할**: `kill-check.py active` 실행 → exit 2면 차단 + 사유 출력
- **명령**: `bash hooks/deploy-kill-check.sh`
- **관련**: 07 §7.5, 11 AP-10

#### `hook-cycle-wip` — WIP=1 강제
- **이벤트**: `PreToolUse` (matcher: `Bash`)
- **트리거**: `tool_input.command`에 `cycle-init.py` AND `--force` 없음
- **역할**: `cycles/active` 존재 시 차단
- **명령**: `bash hooks/wip-guard.sh`
- **관련**: SD-03, 11 AP-12 WIP explosion

#### `hook-reversibility-reminder` — 큰 결정 reminder
- **이벤트**: `PreToolUse` (matcher: `Write`)
- **트리거**: `tool_input.file_path`가 `*adr*.md` OR `*design-doc*.md`
- **역할**: C-09 Reversibility 등급 질문 주입: "이 결정은 two-way door인가 one-way door인가?"
- **명령**: `bash hooks/reversibility-prompt.sh`
- **관련**: C-09, C-04 Devil's Advocate

---

### D. 학습 보존 (Carryover)

#### `hook-retro-on-stop` — 사이클 종료 시 회고 prompt
- **이벤트**: `Stop`
- **트리거**: `cycles/active/retro.md`가 placeholder 상태 (___ 다수 포함) AND cycle status가 Active가 아님
- **역할**: "사이클이 종료 신호를 보였으나 회고가 비어 있음 — `think:retrospective` 호출 권장" 출력
- **명령**: `python3 hooks/retro-reminder.py`
- **관련**: SD-07, R-KP01, 11 AP-22

#### `hook-activity-log` — 활동 자동 누적
- **이벤트**: `PostToolUse` (matcher: `Bash`)
- **트리거**: `tool_input.command`에 `git commit`
- **역할**: 마지막 commit 메시지 + timestamp를 `cycles/active/activity.log`에 append
- **명령**: `bash hooks/activity-log.sh`
- **의도**: 회고 시 *실제 무엇을 했나* 객관 자료

#### `hook-time-tracking` — 시간 자동 누적
- **이벤트**: `SessionStart` (시작 기록), `SessionEnd` (종료 + diff)
- **트리거**: `cycles/active` 존재 시
- **역할**: 세션 길이를 `metrics.json`의 `time_spent_hours`에 누적
- **명령**: `python3 hooks/time-track.py {start|end}`
- **의도**: `kill-check.py`의 시간 임계값에 *실측 데이터* 공급

---

### E. 임계값 알람 (Threshold Alarms)

#### `hook-periodic-kill-check` — 주기적 kill 점검
- **이벤트**: `UserPromptSubmit`
- **트리거**: 매 N번째 prompt (예: 10회마다)
- **역할**: `kill-check.py active` 실행 → soft/hard kill 도달 시 context 주입
- **명령**: `python3 hooks/periodic-kill-check.py`
- **의도**: 매 prompt마다 실행하면 noise — 적당한 간격

#### `hook-pivot-trigger-watch` — Pivot 트리거 신호 감지
- **이벤트**: `UserPromptSubmit`
- **트리거**: 사이클의 사전 정의된 pivot trigger 신호와 prompt 매칭
- **역할**: 매칭 시 "Pivot trigger A 발동 가능성 — 07 §7.6 매핑 확인" 주입
- **명령**: `python3 hooks/pivot-watch.py`
- **관련**: 07 §7.6, 09 §9.4

---

## Hook 우선순위 표 (구현 순서)

| 순위 | Hook | 이유 |
|---|---|---|
| 1 | `hook-hypothesis-immutability` | AP-06 *물리적* 방지선 — 가장 ROI 높음 |
| 2 | `hook-cycle-context` | 모든 세션의 *맥락 기반선* |
| 3 | `hook-deploy-kill-check` | AP-10 자동 알람 — 큰 행동 직전 |
| 4 | `hook-cycle-wip` | WIP=1 강제 — 단순하고 강력 |
| 5 | `hook-adr-immutability` | 결정 불변성 |
| 6 | `hook-activity-log` + `hook-time-tracking` | kill-check.py에 데이터 공급 |
| 7 | Anti-pattern detectors (B 그룹) | Noise 위험 — 천천히 보정 |
| 8 | `hook-stage-rules` | Context 비대화 위험 — 조심 |
| 9 | `hook-retro-on-stop` | 빈도 낮음 |
| 10 | `hook-pivot-trigger-watch` | 사이클별 설정 필요 |

## 구성 (settings.json 예시)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {"type": "command", "command": "bash _draft/harness/hooks/cycle-context.sh"}
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {"type": "command", "command": "bash _draft/harness/hooks/block-hypotheses-edit.sh"}
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {"type": "command", "command": "bash _draft/harness/hooks/deploy-kill-check.sh"}
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {"type": "command", "command": "python3 _draft/harness/hooks/detect-solution-shopping.py"},
          {"type": "command", "command": "python3 _draft/harness/hooks/detect-ship-paralysis.py"}
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {"type": "command", "command": "python3 _draft/harness/hooks/retro-reminder.py"}
        ]
      }
    ]
  }
}
```

## Anti-pattern: Hook ceremony

Hook이 늘면 *모든 prompt가 hook 출력으로 도배* → context 오염 + 정작 룰이 *묻힘*.

- Hook당 출력은 *3줄 이하* 권장
- 같은 종류 경고를 *세션 1회*만 노출 (state 파일로 dedup)
- 분기마다 *발동 빈도 vs 행동 변화* 점검 — 효과 없는 hook은 제거
- 관련: 11 AP-05 Harness ceremony의 *hook 버전*

## 구현 상태

> **이 문서는 *설계 카탈로그*(계획된 16 hook의 spec)다.** *실제 구현된* hook의
> 정확한 목록·wiring·self-test는 canonical [`../plugin/harness/hooks/README.md`](../plugin/harness/hooks/README.md)가
> SSOT. 아래 체크박스는 그 canonical과 동기화한다 (#011 entropy-gc에서 정정 — 이전엔 "전부 미구현"으로 stale).

실전 사이클 1회 후 *진짜 필요한 것*만 구현 권장. #002~#008에서 5개 Computational Sensor 구현됨.

- [x] hook-hypothesis-immutability (1순위) → `hypothesis-immutability.py` (#002, 바·리뷰 데이터 보호로 확장)
- [x] hook-cycle-context (2순위) → `active-cycle-verify.py` (#003, SessionStart)
- [x] hook-deploy-kill-check (3순위) → `deploy-kill-check.py` (#005, UserPromptSubmit)
- [x] (신규) active-symlink-guard → `active-symlink-guard.py` (#007, 종료 경로 강제)
- [x] (신규) session-counter → `session-counter.py` (#004, metrics 갱신)
- [ ] hook-cycle-wip (4순위)
- [ ] hook-adr-immutability (5순위)
- [ ] hook-activity-log
- [ ] hook-time-tracking
- [ ] hook-solution-shopping
- [ ] hook-ship-paralysis
- [ ] hook-rule-exemption
- [ ] hook-discovery-escape
- [ ] hook-stage-rules
- [ ] hook-reversibility-reminder
- [ ] hook-retro-on-stop
- [ ] hook-periodic-kill-check
- [ ] hook-pivot-trigger-watch

## 관련 문서

- [scripts/README.md](../scripts/README.md) — hook이 호출하는 도구들
- [06-rules.md](../06-rules.md) — Stage 태그 (hook-stage-rules의 데이터원)
- [11-anti-patterns.md](../11-anti-patterns.md) — hook이 감지하려는 패턴
- [07-looping-mechanics.md §7.5](../07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준) — kill check 임계값

## 참고

Claude Code hooks 공식: 사용자 환경의 `~/.claude/settings.json` 또는 프로젝트의 `.claude/settings.json`에 등록. 실제 운용 시 *프로젝트 단위*로 등록 — harness가 *이 레포에서만* 활성화.
