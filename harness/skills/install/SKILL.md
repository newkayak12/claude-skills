---
name: install
description: >-
  Use when the user has just installed the harness plugin and is running it for
  the first time, or asks to set up / onboard / configure harness. Triggers on:
  "harness 설치했어", "harness:install", "온보딩 해줘", "user-rule 설정", "처음
  설정", "set up harness", "onboard me", "configure harness", "first run". Runs
  interactive L1 user-rule setup (writes ~/.harness/user-rules.md) and explains
  what the harness loads when.
scenarios:
  - "harness 방금 깔았어 — 초기 설정 도와줘"
  - "user-rule 어떻게 정해? 온보딩 해줘"
  - "I just installed harness, set me up"
  - "Configure my harness defaults"
  - "harness 처음 실행이야"
compatibility:
  optional:
    - sequential-thinking   # 한 질문씩 온보딩을 단계적으로 진행
related:
  - cycle
  - rule-layering
---

# Harness Install — 첫 실행 온보딩

설치 직후 *대화로* L1 user-rules를 만들고, 하네스가 *언제 무엇을 로드하는지* 알려준다.
**수동으로 파일을 작성하는 게 기본 경로가 아니다** (GOAL §3.2) — 이 스킬이 묻고, 스크립트가 쓴다.

## Step 0: 사전 점검 — `python3` (가장 먼저, pure-shell)

하네스의 모든 hook·스크립트는 `python3` 인터프리터에 의존한다. **없으면 매 세션 SessionStart
hook이 전부 실패하고 모든 스킬 명령이 깨진다** — hook 자신이 python3라 graceful degrade도 못 한다.
그래서 *python3를 경유하지 않는* 순수 셸 체크로 가장 먼저 확인한다.

```bash
command -v python3 >/dev/null 2>&1 \
  && echo "✓ python3 OK: $(command -v python3)" \
  || echo "🛑 python3 없음 — 하네스는 python3가 PATH에 있어야 동작. 설치/별칭 후 재시도. (macOS: Xcode CLT / Linux: 패키지 / Windows: python.org 설치 후 'python3' 실행 가능한지 확인 — 'python'만 있으면 hook이 못 찾는다)"
```

`python3 없음`이 뜨면 **STOP** — 사용자에게 python3 설치를 안내하고 온보딩을 멈춘다. 이걸 통과해야 아래가 의미 있다.

## Step 1: 이미 설정됐는지 확인

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py path   # 경로 확인
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py show   # 있으면 내용 출력
```

이미 있으면 **STOP** — 내용을 보여주고 "룰 *추가*(add)할지 / 둘지" 묻는다. 덮어쓰지 않는다(멱등).

## Step 2: 한 질문씩 — L1 기본값 수집

전부 *선택적*. 한꺼번에 쏟지 말고 하나씩. 모르면 건너뛴다(나중에 `add`).

1. **선호 언어/스택?** (예: "Python 3.12 / FastAPI", "TypeScript / Next.js")
2. **코드 스타일** — *내용 말고 설정 파일 경로*만 (§5, AP-29). Python이면 `pyproject.toml`? JS면 `biome.json`?
3. **기본 WIP** — L0 Default는 WIP=1. 그대로? 조정?

> 코드 스타일을 *말로* 받지 마라("4 spaces"). drift한다. **toolchain 설정 파일 위치**만 받는다 — 하네스는 *설정 존재*만 검증한다.

## Step 3: user-rules 생성

모은 답으로 호출 (준 항목만 플래그):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py init \
  --lang "Python 3.12 / FastAPI" \
  --pointer-python "pyproject.toml" \
  --wip "1"
```

→ `~/.harness/user-rules.md` 생성 (12-rule-layering frontmatter). 나중에 룰 1개 추가:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py add \
  --id R-USER-DDD01 --title "DDD 4-layer 선호" --layer L1 --scope default \
  --why "새 프로젝트 기본 아키텍처"
```

`init`은 파일이 있으면 거부(멱등), 재생성은 `--force`(`.bak` 백업 후)만. 중복 id `add`도 거부.

## Step 4: "언제 무엇이 로드되나" 안내 (GOAL §3.3 / CA-1)

사용자에게 *명시*한다 — 설치 후 AI 작동 메커니즘:

| 시점 | 로드/발동 | 무엇 |
|---|---|---|
| **세션 시작 (자동)** | hook `rule-inject` | **effective 룰(L1>L0 머지) 전량을 컨텍스트에 *자동 주입*** — 방금 만든 L1 user-rules가 매 세션 모델 눈에 들어온다. 포맷은 1줄/룰로 압축(**lossless**, 766→620 ≈19%↓, 룰 누락 0). *주입 ≠ 강제*(강제는 게이트/hook). effective 0이면 무출력. |
| 세션 시작 | hook `active-cycle-verify` | 진행 중 사이클 무결성 점검 |
| 새 사이클 시작 | `harness:cycle` | pre-cycle 진입 게이트 → 통과 시 `cycle-init.py` scaffold |
| 작업 단계별 (수동, 세분) | `rules-merge.py effective --stage <stage>` | 특정 stage의 effective 룰만 좁혀 보고 싶을 때. invariant 보호, 충돌은 `conflicts`. (stage 진입 시 *자동 재주입*되면 세션주입을 단계별로 더 줄일 수 있음 = 후속. L2/L3도 후속) |
| 가설/품질-바 등록 | hook `hypothesis-immutability` | `hypotheses.jsonl`/`bar.jsonl` tamper-evident 잠금 (#006) |
| 사이클 종료 | `close-cycle.py` | 바별 독립 리뷰(#007) + cross-cycle ratchet(#008) 게이트 |

> 자동주입(SessionStart)은 *전량 effective*(머지된 L0+L1)를 1줄/룰 압축으로 흘린다 — **lossless** 766→620(≈19%↓), 룰 누락 0. 더 줄이려면(코딩 룰을 코딩 단계에만 주입) stage-entry 자동 재주입이 필요 = 후속. 정적 default를 그냥 빼면 코딩 룰(SOLID/KISS/…)이 사라져 *기능저해*라 보류(독립 리뷰 판정).

## Step 5: 다음 행동 제시

"이제 `harness:cycle`로 첫 사이클을 시작할 수 있다"고 안내. 프로젝트별 L2 룰은 첫 사이클 진입 시 합의(GOAL §2 step 4).

## What Claude Does
- Step 0에서 `python3` pure-shell preflight — 없으면 STOP하고 설치 안내 (hook이 죽지 않게)
- Step 1에서 기존 user-rules 확인 — 있으면 덮어쓰지 않고 add 여부만 물음
- 한 질문씩 L1 기본값 수집 (한꺼번에 쏟지 않음)
- 코드 스타일은 *설정 파일 경로*로만 받음 (내용 거부 — AP-29)
- `user-rules-init.py`로 멱등 생성, "언제 무엇이 로드되는지" 표로 명시

## What You Do
- 언어/스택·스타일 설정파일·WIP 기본값에 답 (모르면 건너뜀)
- 코드 스타일은 toolchain 설정 파일로 관리 (말로 적지 않음)
- 첫 사이클은 `harness:cycle`로

## Related Skills
- `harness:cycle` — 첫 사이클 진입 게이트
- `12-rule-layering.md` — L1/L2/L3 레이어 구조
