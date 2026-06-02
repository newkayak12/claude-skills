# Golden Principles — 하네스 자신의 엔트로피 정의 (원칙6)

> 원칙6(엔트로피 GC)을 *하네스 코드 자체*에 적용하기 위한 **선언된** golden-principles.
> `gc-scan.py`가 이 목록의 각 GP-id를 **1:1로** 검사한다. 스캔은 *선언이지 추론이 아니다*
> (#010 §2 비해석 원칙의 GC 적용). 새 엔트로피 패턴은 *먼저 여기 GP로 선언*한 뒤 스캐너에 추가.
> 관련: [gc.md](./gc.md)(컨텍스트 엔트로피 GC 이론) · [TODO.md](./TODO.md) 키스톤 · 원칙6

---

## 측정 대상

`gc.md`는 *런타임 컨텍스트 윈도우*의 엔트로피(대화 누적 노이즈)를 다룬다.
이 문서는 그 사촌 — *리포지토리 표면*의 엔트로피(시간이 지나며 드리프트한 죽은 파일·링크·중복)다.
원칙6의 "golden principles 정의 → 스캔 → 정리 PR"을 **우리 코드에 적용**한 것.

---

## GP-1 — relic 코드 디렉토리 (watch — advisory)

**선언**: 최상위(plugin 밖) 디렉토리가 `README.md`만 담고 실제 코드(`*.py`/`*.sh`)가 0개이며,
그 디렉토리의 canonical 구현이 `plugin/harness/<같은이름>/` 아래에 살아있으면 → **relic 후보**.

- **근거**: SSOT는 plugin. 코드가 plugin으로 졸업한 디렉토리(`#001 F6`)는 진부화 *후보*.
- **탐지**: `scripts/`, `hooks/` 류 — README 외 코드 0 + `plugin/harness/<name>/`에 코드 존재.
- **왜 high-confidence가 아닌가 (#011 실증)**: 이 구조 신호만으로는 *relic*과 *의도적 signpost*를
  못 가른다. #011에서 2건 탐지 → **0건이 안전 삭제 대상**이었다:
  - `scripts/README.md` = 코드 위치 안내 + "설계 원칙(유지)"·"도구 추가 기준" = *살아있는 가이드*. **유지**.
  - `hooks/README.md` = 16-hook 설계 카탈로그(13이 위임) — 단, "구현 상태"가 stale("전부 미구현"인데 5개 구현). **상태만 정정**(삭제 아님).
  구조 휴리스틱(코드0·canonical존재·canonical에README존재)은 전부 거짓양성을 냈다 → 내용을 읽어야 풀림.
- **처리**: **사람이 내용 검토 후** 삭제/relocate/유지/정정 판정. 자동 삭제 금지.
  (#009 F1·#010 F1과 동형: 실제 적용 전엔 맞아 보이는 탐지기.)

## GP-2 — 죽은 네비게이션 링크 금지 (high-confidence)

**선언**: 마크다운의 `](상대경로)` 링크 타깃(앵커 `#...` 제외)이 파일시스템에 **존재하지 않으면** → dead-link.

- **근거**: 죽은 링크는 지도(원칙1)를 거짓으로 만든다. 에이전트가 따라가면 막다른 길.
- **탐지**: `](`로 시작하는 상대경로 링크, `http`/`#`-only 제외, 타깃 resolve 실패.
- **범위**: live 문서(개념 docs, README)는 **차단**. `plans/`(실행 완료된 *역사적* 기록)는
  whitelist — 과거 스냅샷이라 링크 진부화 허용 (단 리포트엔 표시).
- **처리**: 링크 수정 또는 제거. relocate로 생긴 dead-link는 같은 PR에서 수선.

## GP-3 — 중복 파서: Rule of Three watch (advisory)

**선언**: *선언된 중복-우려 그룹*(아래 레지스트리)의 멤버 함수 개수를 센다.
`R-CD04`(DRY는 Rule of Three까지)에 따라 **2 = WATCH**(허용), **≥3 = ESCALATE**(통합 요구).

- **근거**: 조기 추상화는 잘못된 축을 깎는다(#010 의심: ruleslib↔rules-load L0 파서 WET는
  *의도적* 2번째 등장). 3번째가 등장할 때 비로소 공유 추출.
- **레지스트리** (중복-우려 그룹 = 같은 아티팩트를 파싱):
  - `l0-parser`: `ruleslib.py::parse_l0` · `rules-load.py::parse_rules` (둘 다 06-rules.md L0 카탈로그 파싱)
- **처리**: 2면 무행동(watch). ≥3이면 ESCALATE — 공유 lib로 추출하는 후속 사이클.

---

## high-confidence vs watch

- **high-confidence** (GP-2): 결정론적·명백·auto-actionable. *fixpoint 대상* — 정리 후 0이어야 함(B4).
- **watch** (GP-1, GP-3): 사람 판정 필요. GP-1=내용검토(signpost↔relic), GP-3=R-CD04상 2까지 허용.
  fixpoint 0 요구 대상 아님(리포트만). **#011 교훈: 내용 판단이 필요한 건 high-confidence가 아니다.**

## 멱등 / fixpoint

정리 후 `gc-scan.py`를 재실행하면 high-confidence 항목이 **0**이어야 한다(또는 명시 whitelist).
이것이 GC가 *수렴*했다는 증거다. (`gc.md` §6.6 멱등성의 표면 버전.)
