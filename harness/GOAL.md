# Harness Engineering — Goal

이 문서는 `_draft/harness-engineering/`의 *최종 사용 목표*를 선언한다. 모든 설계 결정·반론 검토·다음 단계 작업은 이 목표를 기준으로 평가된다. 이후 사용자와의 interaction도 이 목표를 전제로 진행된다.

## §1. Goal Statement

> **Marketplace 설치 → `harness:~ install` → 사용자와 interactive로 user-rule 정의 → 정해진 룰을 적용해 기획-개발-테스트 사이클을 돌리며 제품을 개발한다.**

즉 하네스는 *읽는 문서*가 아니라 *실행되는 install가능한 플러그인*이며, 첫 실행 시 사용자와 *대화*로 환경을 조성하고, 그 후 매 사이클에서 *적용된다*.

## §2. Operational Flow

```
[1] Marketplace 검색·설치
        │
        ▼
[2] harness:install  (또는 동등 명령)
        │  - 대상 프로젝트 .claude/ 에 hooks + settings.json + CLAUDE.md scaffold (§2.1)
        │  - 전역 플러그인은 *설치기/생성기*로만 동작
        ▼
[3] Interactive user-rule 정의       ← 첫 실행 시 1회
        │  - 코드 스타일 (tool pointer)
        │  - 선호 언어/스택
        │  - WIP, 사이클 길이 등 default override
        │  - L1 user-rules.md 생성
        ▼
[4] 프로젝트 시작 시 project-rules 합의   ← 프로젝트마다 1회
        │  - L2 project-rules.md 생성
        │  - L0 Core invariant 확인
        ▼
[5] 사이클 진입                        ← 매 사이클마다
        │  - Pre-cycle gate (09)
        │  - cycle-init.py로 폴더 scaffold
        │  - 가설 등록 (hash chain)
        ▼
[6] 기획 → 개발 → 테스트                ← 사이클 내부
        │  - SRS / Design Doc / ADR 작성 (interaction 필요)
        │  - Gate 1·2 통과 확인
        │  - Kill criteria 모니터링
        ▼
[7] 회고 → carryover → 다음 사이클
```

### §2.1 Delivery model — install = 프로젝트 `.claude/` scaffold = ambient governance

하네스의 전달 단위는 *전역 플러그인 한 벌*이 아니라 **대상 프로젝트의 `.claude/`** 다.
`harness:install`(`project-install.py`)이 대상 레포의 `.claude/` 에 hook 페이로드 +
`settings.json`(hook 배선, `$CLAUDE_PROJECT_DIR/.claude/harness` 참조) + `CLAUDE.md`
(사이클 규율 governance)를 vendoring·scaffold 한다(멱등·기존 보존). `.claude/` 자동 로드가
두 가지를 동시에 푼다:

- **Per-project 타겟팅** — 레포마다 자기 버전(전역 한 버전에 갇히지 않음).
- **Ambient governance** — "그 레포에선 자동으로 하네스 아래서 AI 가 동작"(사이클이 opt-in 호출에 갇히지 않음).

역할 분담(드리프트 방지 원칙):
- **강제**(invariant·plan-before-code)는 **hook** 이 결정론으로 — 스킬(AI 재량)이 아니다.
- **안내**는 scaffold 된 **CLAUDE.md** 가 ambient 로.
- **스킬**은 대화형 진입점(`install`/`cycle`)일 뿐.
- `cycles/`·`.harness/` 는 이미 프로젝트 로컬.

전역 플러그인은 *설치기/생성기*로 축소되고, 실제 규율은 프로젝트 로컬에 산다. 이 모델을 벗어나
(전역 단일 버전·명시 호출-only 사이클로) 회귀하지 않는다 — delivery 가 §1 의 "install → 적용"
정신을 만족시키는 *유일* 경로다.

## §3. 이 Goal이 설계에 부과하는 제약

이 목표가 결정된 이상 다음이 *반드시 충족*되어야 한다:

1. **Install 가능성** — 하네스는 marketplace 배포 가능한 plugin 형태여야 한다. 단순 마크다운 모음이 아니다.
2. **Interactive 초기화** — 첫 실행 시 사용자와의 대화로 L1 user-rules가 만들어진다. 사용자가 수동으로 파일을 작성하는 흐름이 *기본 경로*가 아니다.
3. **AI 작동 메커니즘 명시** — 설치 후 AI가 *언제 무엇을 로드*하는지 정의돼 있어야 한다 (devils-advocate `CA-1`).
4. **단계별 적용 지점** — 기획/개발/테스트 각 단계에서 *어떤 hook·skill·문서가 활성화*되는지 매핑이 있어야 한다.
5. **사이클 단위 가치 증명** — 첫 사이클 1회를 끝낸 사용자가 "이 하네스가 도움이 됐다"고 말할 수 있어야 한다. 둘째 사이클까지 가치를 미루지 않는다.
6. **Per-project ambient delivery** — install 은 대상 프로젝트 `.claude/` 에 scaffold 하여 그 레포 안에서 *자동으로* 적용된다(§2.1). 전역 한 버전·명시 호출-only 로 회귀하지 않는다.

## §4. *Goal이 아닌* 것 (Boundaries)

오인 방지를 위해 명시:

- **팀 협업 도구가 아니다** — 솔로 dev 전용. 다인 작성자 충돌은 다루지 않는다.
- **CI/CD 시스템이 아니다** — 빌드/배포/테스트 인프라는 외부 도구(pre-commit, GitHub Actions 등)에 위임한다. 하네스는 *설정 존재*만 검증한다 (`12-rule-layering.md §5`).
- **프로젝트 관리 도구가 아니다** — Jira/Linear 대체가 아니다. 사이클 내부 *방법론*과 *산출물 분류*만 다룬다.
- **모든 프로젝트에 적용되는 일반론이 아니다** — 솔로 dev의 *제품 한 사이클* (개념-검증-출시)에 특화. 단순 유지보수·버그 픽스에는 over-engineering.

## §5. 진행 중 변경 시

이 문서의 §1 Goal Statement는 *함부로 바꾸지 않는다*. 변경 시:
- 변경 사유를 §6 Change log에 한 줄
- 변경 전 statement를 archive
- 영향받는 design 결정 재검토 (특히 `devils-advocate.md`의 CA·PF가 여전히 유효한지)

## §6. Change log

- 2026-05-28 — 최초 작성. 출처: 사용자 명시적 statement ("marketplace 설치 → harness:~ install → interactive user-rule → 기획-개발-테스트 사이클").
- 2026-06-08 — §2.1 추가: delivery 모델("install = 프로젝트 `.claude/` scaffold = ambient governance") 명문화 + §2 step [2]·§3.6 반영. 사유: delivery 모델 재설계(P0 #014/#014b)가 GOAL 본문에 미반영이라 같은 드리프트 재발 위험(TODO P0 ⓒ).

## §7. 관련 문서

- `README.md` — Goal을 반영한 문서 인덱스
- `00-overview.md` — 개념적 정의 (이 문서의 *what*에 대한 background)
- `05-plugin-mapping.md` — 플러그인 매핑 (이 Goal의 §2 step 6를 구체화)
- `12-rule-layering.md` — L1 User / L2 Project / L3 Cycle (Goal §2 step 3-5의 산출물 구조)
- `devils-advocate.md` — 이 Goal을 향한 진행에 대한 누적 취약점 분석 (특히 `CA-1`, `CA-2`, `PF-1`이 이 Goal의 §3.3·§3.4와 직결)
