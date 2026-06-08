---
name: cycle
description: >-
  Use when starting a new product/dev cycle and you need the pre-cycle entry
  gate before committing time. Triggers on: "새 사이클 시작", "이거 만들어도 될까",
  "사이클 시작해줘", "pre-cycle 게이트", "start a cycle", "should I build this",
  "cycle 돌리자", "하네스 사이클". Runs problem-first gate, declares cycle type,
  scaffolds artifacts, enforces WIP=1.
scenarios:
  - "이 아이디어로 새 사이클 시작해도 될까?"
  - "사이클 하나 돌려보자"
  - "Should I commit to building this? Run the gate"
  - "새 프로젝트 시작 전에 점검해줘"
  - "harness 사이클 시작"
compatibility:
  optional:
    - think-tool          # surfaces hidden motives / second-order effects in self-check
    - sequential-thinking # for stepping through the 5 gate groups
  remote_mcp_note: >-
    think-tool이 있으면 E 자기 점검(진짜 동기·6개월 후 후회)을 더 체계적으로 캘 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - hypothesis-driven-dev
  - decision-maker
  - bias-auditor
---

# Harness Cycle — Pre-cycle Entry Gate

새 사이클을 *시작할 자격*이 있는지 대화로 점검하고, 통과하면 산출물을 scaffold한다. **잘못 시작된 사이클은 잘 끝낼 수 없다.**

이 스킬은 `09-pre-cycle.md` 게이트를 *실행 가능*하게 만든 것이다. 마크다운 5개를 직접 읽는 대신, 이 스킬이 한 군씩 묻고 판정한다.

## The Gate

**산출물 scaffold 전에 게이트를 통과해야 한다.** "간단한" 아이디어도. 게이트 비용은 낮고, 잘못 시작한 사이클의 비용(매몰비용 + 완주 압박)은 크다.

## Step 0: WIP=1 확인 (먼저)

`cycles/active`가 이미 있으면 **STOP**. 새 사이클을 시작하기 전에 현재 사이클을 *명시적으로 종료*해야 한다 (SD-03, AP-12).

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/cycle-init.py --check-wip
```

active가 있으면 그 사이클을 보여주고, 사용자에게 "지금 사이클을 종료할지 / 이번 시작을 보류할지" 묻는다. 강행은 escape-cycle anti-pattern일 수 있으니 한 번 더 확인.

## Step 1: 사이클 타입 선언

먼저 타입을 정한다 — 게이트가 타입에 따라 적응한다 (`09 §9.1b`).

| 타입 | 정의 | 게이트 적응 |
|---|---|---|
| **Product** | 외부 사용자를 위한 제품/기능 | 전체 게이트 그대로. 인터뷰 5명·Gate 1 제품 가설 유효 |
| **Dev-tool / Self** | 본인이 쓰는 도구·자동화 | "인터뷰 5명" → self-dogfooding. Gate 1 → "도구 유용성" |
| **Exploration / Spike** | 학습·검증이 목적 | "문제 진술" → 학습 질문. 시간 Kill 짧게 |

한 질문으로 묻는다. 기본은 Product (가장 빡빡).

## Step 2: 게이트 5군 — 대화로 (한 군씩 OR 한방에)

진입 방식은 사용자 상태에 따라 둘 중 하나:

- **계획이 머릿속에 없는 사용자** → 각 군을 *한 번에 하나씩* 묻는다. 답을 받고 다음으로. 한꺼번에 쏟지 마라.
- **계획이 이미 선 사용자 (context-dump shortcut)** → 사용자가 컨텍스트를 한 번에 쏟으면, AI가 그 내용을 A~E 항목에 **자동 매핑**하고 *빠진 항목만* 추가로 묻는다. 채워진 걸 다시 묻지 마라 — 숙련 사용자에게 한 군씩 캐묻는 건 마찰이다(실사용 피드백).
  - 매핑 결과를 짧게 보여주고("A 문제진술 ✓ / C Kill 기준 ✗ 누락") 누락분만 질문.
  - "메타 입력" 환영: 사용자가 5군을 한 문단으로 줘도 받아서 분해한다.

### A. 아이디어 — 문제부터, 해결책 나중
- 문제 진술이 있는가? *("사용자가 X를 못 한다" 형식 — "Y를 만들고 싶다"가 아님)*
- 누구의 문제인가? 구체적 Persona 1개 이상
- 빈도 × 강도?
- 현재 대안은?
- 해결책에 과몰입하고 있지 않은가? (bias 자기 점검)

> **"Y를 만들고 싶다"로 시작하면 멈춘다** — solution-shopping. 문제 진술로 되돌린다.

### B. 전략적 적합도
- 이전 사이클 학습과 정렬되는가?
- 현재 강점을 활용하나? (또는 의도적 새 영역인가)
- 운영 중 제품과 충돌하지 않는가? (WIP=1)

### C. 비용·시간 — *STOP 위험 지점*
- 시간 예산이 잡혀 있는가?
- 금전 예산이 잡혀 있는가?
- 현재 capacity로 완주 가능한가?
- Kill 기준이 사전 정의되어 있는가?
  - **Exploration 타입은 defer 허용**: 도메인 Kill은 사이클 중 구체화되는 경우가 많다. 사용자가 "Kill은 내가 사이클 중 정리하겠다"고 하면 억지로 확정시키지 마라(형식주의). 세션 기반 Hard/Soft Kill(템플릿 기본값)만 두고 도메인 Kill은 `TBD`로 cycle-card에 TODO 마킹. **단 종료 게이트 전까지는 확정 필수.**
  - Product/Dev-tool은 defer 불가 — 지금 확정.

### D. 검증 가능성 (타입별 적응)
- Gate 1 통과 가능성이 있는가?
- 검증 대상 접근 가능? (Product: 인터뷰 5명 / Dev-tool: self / Exploration: 학습 가능)
- 가설이 반증 가능한 형태인가?

### E. 자기 점검
- 이 사이클의 진짜 동기는? (호기심? 도피? 외부 압력? 시장 기회?)
- 6개월 뒤 후회 시나리오는?
- 이 사이클을 *안 하면* 무엇이 나빠지나? (약하면 자격 약함)

`think-tool`이 있으면 E에서 호출 — 숨은 동기를 캔다.

## Step 3: 결정 매트릭스

| 조건 | 결정 |
|---|---|
| A + D 모두 yes | 진행 가능 |
| C에 1개 이상 no | **STOP** — 예산 부족 (시간/Kill 미정이면 지금 정하고 재판정) |
| C에서 *Kill만* no + 타입=Exploration | 진행 가능 — 도메인 Kill은 `TBD`로 defer, cycle-card에 TODO. 종료 전 확정 (시간 예산은 여전히 필수) |
| B 모두 no | 재검토 — *왜* 지금 이걸 하는가 |
| E 진짜 동기가 도피/외부 압력 | **STOP** — 다른 해결책 모색 |

결정을 *기록 없이* 통과시키지 않는다:
- **Go** → Step 4 scaffold
- **No-go** → 사유 1줄 + 큐 어디로 (재검토/폐기/인계)
- **Defer** → 보류 조건 명시 (어떤 신호가 보이면 재시작)

## Step 4: Go면 — scaffold

게이트 통과 시에만 실행:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/cycle-init.py "<사이클 이름>" --type <product|dev-tool|exploration>
```

생성물: `cycles/<id>/`에 cycle-card · pre-mortem · gate-criteria · retro · findings · hypotheses.jsonl · blackbox.jsonl · metrics.json. `cycles/active` symlink 연결.

그 다음 *대화로 채운다* (빈 칸을 사용자와 함께):
1. cycle-card — 가설(반증조건 포함) · Persona · Kill 기준
2. pre-mortem — 실패 5 + 상위 2개 완화책
3. 각 가설을 tamper-evident 등록 (반증·통과 라인을 *등록 시점에* 고정):
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/hypothesis-register.py register \
     --cycle <id> --id H1 \
     --hypothesis "..." \
     --kill-line "이 조건이면 기각" \
     --pass-line "이 조건이면 통과"
   ```
4. 각 품질 바를 *잠근다* (낮추면 verify에서 hash 불일치로 탐지):
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/bar-register.py register \
     --cycle <id> --id B1 --stage test \
     --criterion "통과 기준" --measure "어떻게 측정하는가"
   ```

## Step 5: 로드맵은 AI가 구조화한다 — 사용자에게 떠넘기지 마라

사용자가 단계를 raw하게 나열하면, 그걸 *그대로 표로 옮기는 건 AI 실패*다(실사용 피드백). AI의 역할은 구조화다:

- raw input → **의존성 분석**으로 순서 최적화
- **병렬 가능 단계** 식별
- **빠진 단계 제안** (예: 이벤트 스토밍, 프로토타이핑, 부하 테스트)
- **리스크 높은 단계를 앞으로** (fail-fast)
- **마일스톤·체크포인트** 설정
- **시간 예산 대비 페이징** (예: 3개월이면 월별 배분)

순서는: 사용자가 *방향·컨텍스트*를 주면 → **AI가 구조화된 로드맵 초안 제시** → 사용자가 조정. 반대가 아니다.
로드맵은 cycle-card Phase 표를 기반으로 `docs/**`에 *파일로* 남긴다 (채팅 표만으로 끝내지 마라 — P8).

## Step 6: 사이클 내 Phase 진행 — 추적·전환·산출물 검증

사이클을 시작만 해놓고 실제 작업을 하네스 *밖에서* 수동 진행하면 안 된다. Phase를 추적한다 (cycle-card Phase 표 + metrics.json `current_phase` = SSOT).

**Phase: Analysis → Design → Planning → Implementation → Validation**

각 phase마다 AI가 지켜야 할 것:
1. **행동 전 현재 phase 확인** — `current_phase` 읽고, 그 단계 작업만. 단계 건너뛰기/섞기 금지(P9).
2. **산출물은 파일로** — 지정 저장 위치(cycle-card Phase 표)에 *파일*로 남긴다. 채팅 표 = 산출물 아님(P8).
3. **Phase 완료 검증** — "산출물이 지정 위치에 파일로 존재하는가" 확인 후에만 다음 phase로. `phase-advance.py`에 `--evidence <path>`를 넘긴다. collaborative phase는 사용자 확인 후 `--confirm-user`와 **`--confirmation-note "<사용자가 무엇에 합의했는지>"`**(H2 — tamper-evident chain에 감사 기록)가 필요하다. 전진은 `phase.jsonl` hash-chain에 박히고, phase-guard는 metrics가 아니라 *이 체인*을 권위 소스로 읽는다(H1). cycle-card 상태를 `✅ done`으로 갱신.
4. **다음 단계 자동 제안** — 완료 시 "다음은 Design phase입니다. 넘어갈까요?"로 전환을 *AI가 제안*. 사용자가 "쭉 넘어가자" 해야만 진행하는 구조는 AI 실패.

### Collaborative 산출물 게이트 (R-PG01 강제)

Design Doc·ADR·로드맵 같은 **collaborative 산출물은 "주입 ≠ 강제"의 사각지대**다. 룰이 컨텍스트에 있어도 AI가 속도 우선으로 혼자 써버린다. 그래서 *명시적 STOP*을 건다:

- **collaborative 산출물은 `draft → review → finalize` 강제.** AI 혼자 완성본을 쓰지 않는다.
- **"쭉 넘어가자" ≠ "확인 없이 다 써라".** 흐름은 끊지 말되, *결정이 필요한 지점에서는 멈춘다.*
- **순서 의존성 강제**: Design Doc이 사용자와 iteration으로 합의되기 *전에* ADR을 쓰지 마라. ADR은 Design Doc 합의를 바탕으로.
- collaborative phase는 사용자 확인 게이트를 통과하기 전엔 `current_phase`를 다음으로 넘기지 않는다.

> 산출물 유형: **solo**(Analysis·Implementation — AI가 진행 후 보고) vs **collaborative**(Design·Planning — draft→review→finalize 필수). cycle-card Phase 표의 "유형" 열 참조.

정당한 phase 전진 예:

```bash
# Analysis 산출물 파일이 있어야 Design 으로 전진
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/phase-advance.py design \
  --evidence docs/v2/analysis.md

# Design Doc 이 사용자 review/finalize 를 거친 뒤에만 Planning 으로 전진
# collaborative phase 이탈 → --confirm-user + --confirmation-note 필수 (H2)
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/phase-advance.py planning \
  --evidence docs/v2/design-doc.md \
  --confirm-user --confirmation-note "design-doc v2 API 계약·데이터모델 사용자 승인"
```

## 종료 (close 게이트)

빌드 후 종료할 때. **자기 채점 금지** — 독립 리뷰어(fresh subagent, doer≠reviewer)가 각 바를 채점해야 close가 열린다.
```bash
# 1) 각 바를 독립 채점 (리뷰 없으면 close 차단)
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/review-register.py register \
  --cycle <id> --id R1 --criterion-id B1 \
  --verdict pass --evidence "바의 measure에 대고 관측한 근거" --reviewer "subagent:..."
# 2) 종료 — active 기준이라 --cycle 인자 없음
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/close-cycle.py
```
> **게이트 우회**: 리뷰/ratchet을 무시하고 닫아야 하면 `close-cycle.py --force --adr <존재하는 문서>` — ADR 결박 + blackbox에 `force-close` 기록(우회는 흔적을 남긴다). 정당하게 *ratchet 축을 상향*(빼기 불가능한 +1, 예: mechanism-count)해야 하면 force가 아니라 `bar-register --baseline-reset`으로 — 리뷰되는 1급 baseline 선언(accept-new-baseline).
> `cycles/`는 *프로젝트 CWD*에 생성된다. 작업 repo에 산출물을 함께 커밋하거나, 원치 않으면 `.gitignore`에 `cycles/` 추가.

## What Claude Does
- 게이트를 대화로 진행 — 계획 없는 사용자는 한 군씩, 계획 선 사용자는 context-dump를 A~E에 자동 매핑하고 *빠진 것만* 질문
- "Y를 만들고 싶다"형 진입을 잡아 문제 진술로 되돌림
- Exploration 타입은 도메인 Kill 기준 defer 허용 (TBD TODO), 종료 전 확정 요구
- 결정을 매트릭스로 판정하고 *기록*
- Go일 때만 scaffold 실행, 그 후 산출물을 사용자와 함께 채움
- **로드맵을 AI가 구조화** (의존성·병렬화·fail-fast·마일스톤) — raw 나열을 그대로 옮기지 않음
- **Phase를 추적** (current_phase 확인 → 산출물 파일 검증 → 다음 단계 자동 제안)
- **collaborative 산출물(Design Doc·ADR·로드맵)은 draft→review→finalize 강제** — 혼자 완성하지 않음

## What You Do
- 각 군 질문에 정직하게 답 (특히 E 진짜 동기)
- 계획이 섰으면 한방에 쏟아도 됨 (AI가 분해)
- 시간 예산은 *지금* 확정 (Exploration이면 도메인 Kill은 사이클 중 가능)
- 방향·컨텍스트를 주면 AI 로드맵 초안을 받아 조정
- collaborative 산출물은 AI 초안을 review하며 iteration

## Related Skills
- `pm:hypothesis-driven-dev` — 가설 사전 등록
- `think:decision-maker` — Go/No-go/Defer
- `cognition:bias-auditor` — E 자기 점검
