# 12. Rule Layering

`06-rules.md`는 *글로벌 invariant + default*만 담는다. 실전에서는 *사용자 스타일*, *프로젝트 컨벤션*, *사이클별 임시 면제*가 추가로 필요하다. 충돌이 발생하면 **해석으로 풀지 않고 declared layer로** 결정한다.

## §1. 4-Layer 구조

| Layer | 위치 | 예시 | 적용 범위 |
|---|---|---|---|
| **L0 Core (invariant)** | `06-rules.md` *(Scope: invariant)* | Kill criteria, 가설 immutability, Gate 점수식 | 모든 사이클·프로젝트 — **override 불가** |
| **L0 Default** | `06-rules.md` *(Scope: default)* | WIP=1, 사이클 14일 상한 | 모든 사이클·프로젝트 — L1/L2/L3가 override 가능 |
| L0.5 Situational | `situational-rules/*.md` | security, data, ops, cognitive, self-discipline | 트리거 발생 시 로드 |
| **L1 User** | `~/.harness/user-rules.md` | "Python은 ruff+black", "함수형 우선" | 이 사용자의 모든 프로젝트 |
| **L2 Project** | `<project>/.harness/project-rules.md` | "Postgres 전용", "DDD 4-layer 강제" | 이 프로젝트만 |
| **L3 Cycle** | `cycles/<id>/exemptions.md` | "이번 사이클만 WIP=2" | 이 사이클만 — **만료일 필수** |

## §2. 충돌 해소

**우선순위**: `L3 > L2 > L1 > L0 Default`. `L0 Core (invariant)`는 모든 레이어보다 위 — **override 절대 불가**.

### 핵심 원칙: *해석 금지*

충돌 시 *어느 룰이 더 정확한가*를 따지지 않는다. **declared layer**로만 결정한다.

```
충돌 예시                                    결과
────────────────────────────────────────────────────────────
L0 Default: WIP=1                          → L3 적용 (WIP=2)
L3 Cycle:   WIP=2 (만료 2026-06-15)

L1 User:    Python indent = 4 spaces       → L2 적용 (tab)
L2 Project: Python indent = tab

L0 Core:    가설 immutability                → L0 Core 적용 (요청 거부)
L3 Cycle:   가설 수정 요청
```

### 같은 layer 내 충돌

자동 해결 *안 함*. **명시적 결정 필요**:
- 사용자 개입 → 둘 중 하나를 *promote* 또는 *merge*
- Claude가 임의로 고르면 AP-26 (Layer 자동해석) 트리거

## §3. 룰 메타데이터 강제

모든 룰 엔트리는 다음 frontmatter를 가진다:

```yaml
---
id: R-XX-NN
scope: invariant | default
layer: L0 | L0.5 | L1 | L2 | L3
stage: Macro | Meso | Micro | * | post-launch
sunset: YYYY-MM-DD    # L3만 필수
pointer: <설정파일경로>   # 코드 스타일 룰은 필수 (§5)
---
```

이 메타가 없는 룰은 *유효하지 않은 룰*로 본다 — `rules-load.py`가 파싱 거부.

## §4. L0 Core (Invariant) 후보

다음 중 하나라도 충족하면 **invariant**:

1. **Kill criteria 발동 기준** — 재진입 3회 / 시간 200% / 예산 100%
2. **가설 immutability** — 등록 후 수정 불가 (해시 체인으로 물리적 보장)
3. **Gate 점수식** — `08-pass-criteria.md §1`의 합산 공식
4. **ADR Status 단방향** — `Proposed → Accepted → Superseded`만 허용
5. **Sunset 없는 L3 금지** — 만료일 강제

위 5개는 *어떤 사용자·프로젝트·사이클*에서도 면제 불가. 면제 요청이 오면 자동 거부 + 이유 명시.

기타 룰(`06-rules.md`의 나머지)은 **default** — 정당한 사유로 L1/L2/L3에서 override 가능.

## §5. 코드 스타일은 Tool Pointer로

**룰 마크다운에 스타일을 직접 적지 마라**. 표류한다.

대신 L1/L2 룰은 *설정 파일 위치만* 명시한다:

```markdown
## R-USER-FMT01: Python formatter
Layer: L1
Scope: default
Pointer: pyproject.toml [tool.black]
Hook: hook-formatter-config-exists
Why: 스타일 enforcement는 toolchain이 함. 하네스는 설정 존재만 검증.
```

### 왜 이렇게?

- 마크다운 룰은 *드리프트* — 코드와 따로 논다
- 진짜 enforcement는 *pre-commit + CI*가 한다
- 하네스는 *"linter가 설정돼 있는가"* 만 검사

### 후보 도구

| 언어/대상 | 도구 | 설정 파일 |
|---|---|---|
| Python | black, ruff, mypy | `pyproject.toml` |
| JS/TS | biome, eslint, prettier | `biome.json` / `.eslintrc.*` |
| Go | gofmt, golangci-lint | `.golangci.yml` |
| Rust | rustfmt, clippy | `rustfmt.toml` / `clippy.toml` |
| 커밋 메시지 | conform, commitlint | `.conform.yaml` |
| Git hook | pre-commit | `.pre-commit-config.yaml` |

하네스 hook은 *파일 존재*만 본다. 내용은 toolchain 책임.

## §6. L3 Cycle Exemption 규칙

`cycles/<id>/exemptions.md`는 *임시 면제*만 담는다.

### 필수 필드

```yaml
---
target_rule_id: R-LP01           # 면제 대상 룰
reason: 긴급 보안 패치 + 검증 사이클 병행   # 한 줄 사유
sunset: 2026-06-15               # 사이클 종료일을 넘을 수 없음
promotion_review: false          # 다음 사이클에서 L2 승격 검토 여부
---
```

### 반복되면 승격

같은 룰에 대한 L3 면제가 *2 사이클 연속* 발생 → **L2 승격 검토 강제**. 임시 면제를 영구 면제로 위장하는 것 차단(AP-30).

### 만료 처리

- `sunset` 도달 → 자동 만료 (다음 hook 발동 시 무효 처리)
- 사이클 종료 → 모든 L3 일괄 무효
- 만료 후 같은 면제 필요 시 → 새 사이클의 새 exemption (자동 갱신 금지)

## §7. 도입 순서

| 단계 | 작업 | 트리거 |
|---|---|---|
| 1 | `06-rules.md`에 Scope (invariant/default) 표기 | 즉시 |
| 2 | `~/.harness/user-rules.md` 템플릿 생성 | 첫 프로젝트 시작 시 |
| 3 | `<project>/.harness/project-rules.md` scaffold | `cycle-init.py` 첫 실행 시 |
| 4 | `cycles/<id>/exemptions.md` | 필요 시점에만 |

**L0 Core 분류가 가장 먼저**. 이게 안 정해지면 모든 레이어가 의미를 잃는다.

## §8. What Claude Does / What You Do

### Claude

- 룰 충돌 감지 시 layer 비교 → 자동 결정
- 적용된 룰의 layer를 *명시*: "L2 Project rule `R-PROJ-FMT01`에 따라 tab 적용"
- L0 Core override 요청 → 거부 + 이유 명시
- 같은 layer 내 충돌 → 사용자에게 결정 요청 (자동 해석 금지)
- `pointer:` 필드만 있는 스타일 룰은 *설정 파일 내용을 읽어* 적용

### You

- L1/L2 룰 작성 및 유지
- L3 exemption은 cycle-card 작성 시 함께 등록
- 반복되는 L3는 L2로 승격 검토
- L0 Core 분류는 *프로젝트 시작 전* 동의

## §9. Anti-patterns (신규)

| Code | 이름 | 증상 |
|---|---|---|
| AP-26 | Layer 자동해석 | 같은 layer 충돌을 Claude가 임의 선택 |
| AP-27 | Invariant 우회 시도 | L3로 L0 Core 면제 요청 |
| AP-28 | Sunset 없는 L3 | 만료일 없이 임시 면제 등록 |
| AP-29 | Style markdown drift | 코드 스타일을 룰 마크다운에 직접 기술 (toolchain 위임 안 함) |
| AP-30 | Promotion 회피 | L3 반복 면제로 L2 승격 회피 |

각 AP의 *Symptom / 알람 / 대응*은 `11-anti-patterns.md`에 카테고리 **G. Rule Layering**으로 추가 필요.

## §10. 관련 문서·도구

- `06-rules.md` — L0 Core/Default 룰 본문 (Scope 메타 강제 필요)
- `08-pass-criteria.md` — Gate 점수식 = L0 Core
- `09-pre-cycle.md` — cycle-card에 L3 exemption 등록 절차
- `11-anti-patterns.md` — AP-26~30 본문 (작성 필요)
- `scripts/rules-load.py` — Stage + Layer 동시 필터링으로 확장 필요
- `scripts/cycle-init.py` — `project-rules.md` + `exemptions.md` scaffold 추가 필요
- `hooks/README.md` — `hook-formatter-config-exists`, `hook-l3-sunset-check` 추가 필요
