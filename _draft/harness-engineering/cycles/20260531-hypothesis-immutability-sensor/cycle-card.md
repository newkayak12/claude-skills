# Cycle Card — hypothesis-immutability-sensor

| Field | Value |
|---|---|
| Cycle ID | 20260531-hypothesis-immutability-sensor |
| Start | 20260531 |
| Cycle type | Dev-tool  (Product / Dev-tool / Exploration — see [09 §9.1b](../../09-pre-cycle.md#91b-사이클-타입--게이트는-타입에-따라-적응한다)) |
| Time budget | 1 session (appetite) |
| Cost budget | ~0 (로컬 hook + stdlib) |
| Status | Active |

## 문제 진술

> 하네스에 **Guide는 있으나 사이클 *중* 차단하는 Computational Sensor가 없다**. `hypothesis-register.py`는 변조를 *탐지*하지만, 사람이 `verify`를 불러야만 작동 — 안 부르면 무력. 등록된 가설을 사후에 손으로 고쳐도 *물리적으로 안 막힌다* (`AP-06` Gate fudging / `CV-1` 자기 설득).

## 핵심 가설 (≤3)

- H1: hypotheses.jsonl을 *손으로 수정*하려는 시도가 PreToolUse hook으로 **차단**되면, AP-06이 물리적으로 방지된다 (Böckeler *Sensor*의 첫 실증).
- H2: hook 차단의 *정당한 우회 경로*(=`hypothesis-register.py`로 새 ID 추가)는 막히지 않는다 → false positive 0.

> 가설 *공식 등록*은 `${CLAUDE_PLUGIN_ROOT}/scripts/hypothesis-register.py register` — tamper-evident.
> 위 H1~H2는 *사람이 보는* 요약, 실제 통과/기각 라인은 hypotheses.jsonl이 SSOT.

## Persona 가설

- 나 자신 (n=1 self-user). 미래의 내가 검증 실패를 회피하려 가설을 슬쩍 고치는 순간이 표적.

## 성공 기준 (수치 — dev-tool 적응)

- Gate 1 (도구 유용성): hypotheses.jsonl 직접 Edit 시도 → hook이 **차단**(self-test 1회 통과). `hypothesis-register.py` 정상 등록은 **통과**(false positive 0)
- Gate 2 (기술): hook이 PreToolUse 입력 JSON을 파싱해 Edit/Write/MultiEdit 대상 file_path를 정확히 판별, exit 2로 차단. 비대상 Edit은 exit 0

## Kill 기준

- **Hard**: 1 session 내 *실제 차단 1회 실증* 실패 / 재진입 3회 / 시간 200%
- **Soft**: 시간 150% → 재평가
- **즉시 kill**: hook이 정당한 Edit까지 막아 false positive가 나면(H2 위반) → 설계 재검토

## 이전 사이클 인계 (살림 / 의심 / 버림)

- 살림: #001의 `cycle-init.py`, `harness:cycle` 스킬, "설치 가능의 물리적 정의" 패턴, F10 Böckeler Guide/Sensor 프레임
- 의심: hook이 *모든 편집 경로*를 잡는가 (MultiEdit/NotebookEdit 등 변종)
- 버림: 없음

## Pivot triggers (사전 정의)

- hook이 정당한 Edit을 막음 (false positive) → **Platform pivot**: 차단을 *경고+verify*로 완화
- PreToolUse 입력 스키마가 예상과 다름 → **Zoom-in**: 스키마 확인을 먼저 산출물로
- 세션 *밖* 편집(에디터 직접)은 PreToolUse로 못 막음 발견 → **Scope-down**: SessionStart verify 경고를 짝으로 추가

## 관련 문서

- Pre-mortem: ./pre-mortem.md
- Gate criteria: ./gate-criteria.md
- Hypotheses: ./hypotheses.jsonl
- Retro: ./retro.md
- Activity log: ./activity.log
- Black box (어긴 것 기록): ./blackbox.jsonl  → [13 §4](../../13-operational-layer.md#4-black-box--막지-말고-기록)
- Dogfood findings: ./findings.md
