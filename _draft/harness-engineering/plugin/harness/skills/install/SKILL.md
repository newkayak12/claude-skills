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

두 가지를 한다: **(A) 현재 프로젝트를 harness 아래로 scaffold** (`.claude/` 에 벤더링 — per-project·ambient),
**(B) L1 user-rules 를 대화로** 만든다(사용자-전역 기본값). 하네스가 *언제 무엇을 로드하는지*도 알려준다.
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

## Step A: 프로젝트를 harness 아래로 scaffold/갱신 (핵심 delivery — 첫 설치 *그리고* update)

> 이게 "그냥 쓰면 자동으로 하네스 아래서 동작"의 실체다. 전역 플러그인이 아니라 *이 프로젝트의
> `.claude/`* 에 하네스를 vendoring 해서, `.claude/` 자동로드로 per-project + ambient governance 를 얻는다.

**이 단계는 첫 설치든 update든 *항상 먼저* 돈다.** marketplace 에서 플러그인을 `update` 했으면
*전역* 버전만 새것이고 이 프로젝트의 벤더링은 *옛 버전 그대로*다 — 재-벤더해야 새 버전이 프로젝트에 닿는다.

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/project-install.py --project "$CLAUDE_PROJECT_DIR" --dry-run  # 계획/버전 확인
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/project-install.py --project "$CLAUDE_PROJECT_DIR"            # 실행
```

멱등 + **버전 인식**이다 — 벤더 마커 버전과 소스 버전을 비교해 `신규 설치 vX` / `이미 최신 vX` /
`업그레이드 vX→vY` 를 *보고*한다(거부가 아니라 정보성 — 같은 버전이어도 새로고침 재-벤더). `.claude/harness/`
(페이로드) + `.claude/settings.json`(hooks, `$CLAUDE_PROJECT_DIR` 기준) + `.claude/CLAUDE.md`(사이클 규율)를
만들거나 *기존을 보존하며 병합*한다. 기존 사용자 내용은 지우지 않는다. 설치/갱신 후 **그 프로젝트의 새 세션부터** 반영된다.

> vendoring = 레포에 커밋되어 따라다니는 *고정 버전*. **update 반영 = 그 프로젝트에서 `harness:install`
> 재실행(이 Step A 재-벤더)** 이 유일 경로 — 전역 플러그인 갱신만으론 프로젝트에 안 닿는다.

## Step 1: L1 user-rules — 이미 있으면 *이 단계만* 건너뛴다 (전체 STOP 아님)

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py path   # 경로 확인
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py show   # 있으면 내용 출력
```

이미 있으면 **user-rules 단계(Step 2~3)만 건너뛴다** — 내용을 보여주고 "룰 *추가*(add)할지" 묻고
넘어간다. 덮어쓰지 않는다(멱등). **온보딩 전체를 멈추지 말 것** — Step A(프로젝트 재-벤더)는 이미 돌았고
update 시엔 그게 핵심이다. 여기서 "이미 설치됨"으로 끝내면 *새 버전이 프로젝트에 반영 안 된 채* 종료된다(실사용 결함).

## Step 2: 한 질문씩 — L1 기본값 수집

전부 *선택적*. 한꺼번에 쏟지 말고 하나씩. 모르면 건너뛴다(나중에 `add`).

1. **선호 언어/스택?** (예: "Python 3.12 / FastAPI", "TypeScript / Next.js", "Kotlin 2.0 / Spring Boot")
2. **코드 스타일** — *내용 말고 설정 파일 경로*만 (§5, AP-29). Python이면 `pyproject.toml`? JS면 `biome.json`? Kotlin이면 `detekt.yml`? Java면 `checkstyle.xml`? 그 외 언어면 범용 `--pointer <name> <path>`.
3. **기본 WIP** — L0 Default는 WIP=1. 그대로? 조정?

> 코드 스타일을 *말로* 받지 마라("4 spaces"). drift한다. **toolchain 설정 파일 위치**만 받는다 — 하네스는 *설정 존재*만 검증한다.

## Step 2.5: 파일이 *어디에* 생기는지 먼저 안내 (생성 전, 필수)

다음 Step에서 파일을 쓰기 *전에*, 어디에 생기는지 명시한다 — 그러지 않으면 "프로젝트 안에 생길 줄 알았다"는 혼란이 생긴다(실사용 피드백).

- **L1 user-rules → `~/.harness/user-rules.md` (홈 디렉토리, 전역)**: 이 사용자의 *모든 프로젝트*에 적용. 지금 만드는 게 이것.
- **L2 project-rules → 프로젝트 내부**: *첫 사이클 진입 시* 그 프로젝트에서만 합의·생성 (GOAL §2 step 4). 지금이 아님.

CWD가 프로젝트 디렉토리여도 L1은 홈에 생긴다는 점을 한 줄로 못 박는다. `path` 명령으로 실제 경로를 *보여준 뒤* 진행한다.

## Step 3: user-rules 생성

모은 답으로 호출 (준 항목만 플래그):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py init \
  --lang "Kotlin 2.0 / Spring Boot" \
  --pointer-kotlin "detekt.yml" \
  --pointer-java "checkstyle.xml" \
  --wip "1"
```

포인터 플래그: `--pointer-python` · `--pointer-js` · `--pointer-kotlin` · `--pointer-java`. 그 외 언어/툴은 범용 `--pointer <name> <path>`(반복 가능):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py init \
  --lang "Go 1.22" --pointer go ".golangci.yml" --pointer sql "sqlfluff.cfg"
```

→ `~/.harness/user-rules.md` 생성 (12-rule-layering frontmatter). 나중에 룰 1개 추가:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py add \
  --id R-USER-DDD01 --title "DDD 4-layer 선호" --layer L1 --scope default \
  --why "새 프로젝트 기본 아키텍처"
```

`init`은 파일이 있으면 거부(멱등), 재생성은 `--force`(`.bak` 백업 후)만. 중복 id `add`도 거부.

생성된 L1 룰은 **세션 시작마다 `rule-inject` hook이 자동 주입**한다 — 수동 명령 불필요. (자동주입 메커니즘은 Step 4 표 참조)

## Step 4: "언제 무엇이 로드되나" 안내 (GOAL §3.3 / CA-1)

사용자에게 *명시*한다 — 설치 후 AI 작동 메커니즘:

| 시점 | 로드/발동 | 무엇 |
|---|---|---|
| **세션 시작 (자동)** | hook `rule-inject` | **항상-켜둘 룰(invariant L0 + L1)을 컨텍스트에 *자동 주입*** — 단계와 무관하게 세션 내내 유효한 룰(R-PG 프로세스 게이트·R-DoD·R-DD·R-AI + 방금 만든 L1 user-rules)만. 단계별 코딩/아키텍처 룰은 빠진다(↓ stage 진입 hook이 커버). 1줄/룰 압축(**lossless** 슬라이스 내 룰 누락 0). ≈**385 tokens**(전량 620 대비, 정적 default를 단계로 이관). *주입 ≠ 강제*. |
| **단계 진입 (자동)** | hook `stage-inject` (PreToolUse) | **그 단계의 룰을 *단계가 시작되는 순간* 자동 주입.** 코드 작성 시작(Edit/Write 도구 호출) = `code-writing` 진입 → R-CD 코딩 룰(SOLID/KISS/YAGNI/…)이 *바로 그때* 주입(~309 tokens). 세션·단계당 1회(de-dup). 방어를 세션 *경계*에서 플로우 *내부*로 확장(CA-10). `permissionDecision=allow` — 도구 안 막음, *주입 ≠ 강제*. |
| 세션 시작 | hook `active-cycle-verify` | 진행 중 사이클 무결성 점검 |
| 새 사이클 시작 | `harness:cycle` | pre-cycle 진입 게이트 → 통과 시 `cycle-init.py` scaffold |
| 작업 단계별 (수동, 세분) | `rules-merge.py effective --stage <stage>` | 특정 stage의 effective 룰만 좁혀 보고 싶을 때(자동주입 외 수동 조회). invariant 보호, 충돌은 `conflicts`. (L2/L3는 후속) |
| 가설/품질-바 등록 | hook `hypothesis-immutability` | `hypotheses.jsonl`/`bar.jsonl` tamper-evident 잠금 (#006) |
| 사이클 종료 | `close-cycle.py` | 바별 독립 리뷰(#007) + cross-cycle ratchet(#008) 게이트 |

> 자동주입은 이제 *두 시점*으로 나뉜다(독립 리뷰 CA-10 해소). **SessionStart**(`rule-inject`)는 *항상-켜둘* 룰(invariant L0 + L1)만 — ≈385 tokens(전량 620 대비). **단계 진입**(`stage-inject`, PreToolUse)이 코드 작성 시작 시점(Edit/Write)에 그 단계 룰(R-CD 코딩 룰 등 ~309 tokens)을 *바로 그때* 재주입한다. **기능 저해 없음**: 예전 전량주입에 있던 코딩 룰은 *전부 그대로 모델에 도달*한다 — 다만 세션 시작이 아니라 *코딩이 실제 시작되는 순간*에. 순효과: 세션시작 토큰 ↓ **AND** 방어가 경계→플로우 *내부*로 확장(긴 세션에서 룰이 스크롤아웃돼도 단계 진입마다 재도달). 둘 다 *주입 ≠ 강제*(강제는 게이트/차단성 hook).

## Step 5: 다음 행동 제시

"이제 `harness:cycle`로 첫 사이클을 시작할 수 있다"고 안내. 프로젝트별 L2 룰은 첫 사이클 진입 시 합의(GOAL §2 step 4).

## What Claude Does
- Step 0에서 `python3` pure-shell preflight — 없으면 STOP하고 설치 안내 (hook이 죽지 않게)
- Step A(프로젝트 재-벤더)는 첫 설치든 update든 *항상 먼저* 실행 — "이미 설치됨"으로 STOP하지 않음(update 핵심)
- Step 1에서 기존 user-rules 확인 — 있으면 *user-rules 단계만* 건너뛰고(add 여부만 물음) 온보딩은 계속
- 한 질문씩 L1 기본값 수집 (한꺼번에 쏟지 않음)
- 코드 스타일은 *설정 파일 경로*로만 받음 (내용 거부 — AP-29). JVM 계열은 `--pointer-kotlin/--pointer-java`, 그 외는 범용 `--pointer <name> <path>`
- **파일 생성 *전에* L1(전역 `~/.harness/`) vs L2(프로젝트 내부) 차이를 명시** (Step 2.5)
- `user-rules-init.py`로 멱등 생성, "언제 무엇이 로드되는지" 표로 명시

## What You Do
- 언어/스택·스타일 설정파일·WIP 기본값에 답 (모르면 건너뜀)
- 코드 스타일은 toolchain 설정 파일로 관리 (말로 적지 않음)
- 첫 사이클은 `harness:cycle`로

## Related Skills
- `harness:cycle` — 첫 사이클 진입 게이트
- `12-rule-layering.md` — L1/L2/L3 레이어 구조
