# Harness Engineering — Draft

개인 개발자(엔지니어 출신)가 제품 한 사이클을 끝까지 끌고 가기 위한 **end-to-end 기획 하네스**의 초안. PM/디자이너/아키텍트가 따로 없을 때, 한 사람이 제품 기획부터 기술 설계까지 빠뜨림 없이 진행할 수 있도록 단계와 산출물, 검증 루프, 그리고 각 단계에서 호출할 수 있는 스킬을 정리한다.

> **목표는 [`GOAL.md`](./GOAL.md) 참조** — 이 draft의 종착점은 *읽는 문서*가 아니라 *marketplace 설치 → `harness:install` → interactive user-rule 정의 → 사이클 실행*까지 가는 install 가능한 플러그인이다. 모든 설계 결정과 반론 검토는 이 목표 기준.
>
> **취약점 분석은 [`devils-advocate.md`](./devils-advocate.md)에 누적** — 항목은 `CA-N` `PF-N` `CV` ID로 참조 가능. 새 review는 append로 쌓는다.

## 사용 의도

- "기획 → 검증 → 기술 기획 → 검증" 사이클을 자기 자신에게 강제하는 체크리스트.
- 각 단계마다 **빠뜨리면 안 되는 산출물**과 **확인해야 하는 질문**을 명시.
- 단계별로 호출 가능한 plugin/skill을 매핑해 두어, 필요한 부분만 선택적으로 적용.

## 핵심 원칙

1. **트랙 분리**: 제품 트랙(왜·누가·무엇)과 기술 트랙(어떻게)은 동시에 진행하되 산출물은 분리.
2. **검증은 게이트**: 검증 루프를 통과하기 전에는 다음 트랙으로 넘어가지 않는다. 직감으로 넘기지 않는다.
3. **산출물은 살아 있어야 한다**: SRS, ADR, 아키텍처 다이어그램은 한 번 쓰고 끝이 아니라 버전을 관리한다.
4. **선택적 적용**: 모든 단계의 모든 산출물을 다 채울 필요는 없다. 위험이 높은 영역에 시간을 쓴다.

## 문서 구조

| 파일 | 목적 |
|---|---|
| [00-overview.md](./00-overview.md) | Harness Engineering의 정의, 전체 프로세스 맵, 검증 루프의 위치 |
| [01-product-track.md](./01-product-track.md) | 제품 트랙 — 페르소나부터 MVP 스코프까지 단계별 디테일 |
| [02-tech-track.md](./02-tech-track.md) | 기술 트랙 — 아키텍처, 기술 스택, DB 설계 단계별 디테일 |
| [03-validation-loops.md](./03-validation-loops.md) | 두 검증 루프(제품 가설 검증, 기술 가설 검증)의 방법론 |
| [04-unknowns.md](./04-unknowns.md) | 일반 개발자가 잘 모를 만한 프레임워크와 기법(Opportunity Solution Tree, FURPS+, C4, arc42 등) |
| [05-plugin-mapping.md](./05-plugin-mapping.md) | 각 단계에서 호출할 수 있는 이 레포의 plugin/skill 매핑 |
| [06-rules.md](./06-rules.md) | **항상 적용되는 룰 카탈로그** — 각 룰에 `Stage` 태그가 붙어 단계별 selective 로딩 가능 |
| [07-looping-mechanics.md](./07-looping-mechanics.md) | 4종 루프 (Macro/Meso/Micro/Post-launch) + 재진입 결정 트리 + Kill criteria + Pivot 트리거 매핑 |
| [08-pass-criteria.md](./08-pass-criteria.md) | Gate 1·2 수치 기준 + 가설 사전 등록 + Risk matrix + Performance budget defaults |
| [09-pre-cycle.md](./09-pre-cycle.md) | 사이클 *시작 자격* 게이트 — Cycle Card / Pre-mortem / Pivot trigger 사전 정의 |
| [10-post-launch.md](./10-post-launch.md) | 출시 후 영구 루프 — Continuous Discovery / Sunset playbook / 부채 vs 새 기능 ratio |
| [11-anti-patterns.md](./11-anti-patterns.md) | 25개 고장 모드 카탈로그 (AP-01~25) + 분기 자기 점검 도구 |
| [12-rule-layering.md](./12-rule-layering.md) | 4-layer 룰 시스템 (L0 Core/Default · L1 User · L2 Project · L3 Cycle) + 충돌은 layer 우선순위로 해소 |
| [13-operational-layer.md](./13-operational-layer.md) | **설치된 하네스가 AI 세션에서 실제로 작동하는 방식** — 3-tier loading · trigger→load→apply · rules-as-code · black box 기록 · prompt caching · 토큰 예산 |
| [situational-rules/](./situational-rules/) | **상황 발생 시 참조** — 보안, 데이터, 운영·관측, 사고 규율, 자기 통제 (5개 영역) |
| [templates/README.md](./templates/README.md) | **Interaction-required 문서** 인덱스 + 공통 원칙 (RFC/Design Doc/ADR 매트릭스) |
| [templates/rfc.md](./templates/rfc.md) | RFC (Request for Comments) 템플릿 — 합의 전 제안 |
| [templates/design-doc.md](./templates/design-doc.md) | Design Doc 템플릿 — 설계 청사진 |
| [templates/adr.md](./templates/adr.md) | ADR (Architecture Decision Record) 템플릿 — 결정 선언 |
| [templates/srs.md](./templates/srs.md) | SRS (Software Requirements Specification) 슬림 템플릿 |

## 읽는 순서 제안

**처음이라면**: `00-overview.md` → `06-rules.md` → `12-rule-layering.md` → `09-pre-cycle.md` → `07-looping-mechanics.md` → `08-pass-criteria.md` → `04-unknowns.md` → `05-plugin-mapping.md`.

**실전 사이클 진입 시**: `09-pre-cycle.md` 게이트 체크 → 통과하면 Cycle Card 작성 → `01-product-track.md`/`02-tech-track.md`를 옆에 두고 진행 → `06-rules.md`의 *Stage → Rule Index*로 현재 단계 룰만 로딩 → 게이트마다 `08-pass-criteria.md` 수치 확인.

**Pivot/재진입 발생 시**: `07-looping-mechanics.md` §7.2 결정 트리 + §7.6 pivot 매핑.

**출시 후**: `10-post-launch.md` cadence 진입.

**분기 자기 점검**: `11-anti-patterns.md`를 *읽으며* 최근 3사이클 패턴 점검.

상황별 룰(`situational-rules/`)은 트리거가 발생할 때만 연다. `templates/` 문서들은 *사용자와의 interaction이 필요한* 산출물이며, 하네스가 초안을 준비할 수는 있어도 *합의·결정은 사람이* 한다 — `templates/README.md` 참조.

## 상태

Draft. 실전 사이클 한 번 돌린 뒤 회고로 다듬을 예정. 다듬을 후보:
- `templates/retro.md` 양식 추가 (현재 forward link만 있음)
- `12-cycle-tracking.md` — Cycle Card / 메트릭 추적 도구
- Worked example — 실전 사이클 1회의 산출물 묶음
