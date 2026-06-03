# Golden Principles — 하네스 자신의 엔트로피 정의 (원칙6)

> 원칙6(엔트로피 GC)을 *하네스 코드 자체*에 적용하기 위한 **선언된** golden-principles.
> `gc-scan.py`가 이 목록의 각 GP-id(GP-1~GP-5)를 **1:1로** 검사한다. 스캔은 *선언이지 추론이 아니다*
> (#010 §2 비해석 원칙의 GC 적용). 새 엔트로피 패턴은 *먼저 여기 GP로 선언*한 뒤 스캐너에 추가.
> 결정론으로 닿는 것만 high-confidence(GP-2), 사람 판단 필요한 건 watch(GP-1·3·4·5).
> 관련: [gc.md](./gc.md)(컨텍스트 엔트로피 GC 이론) · [TODO.md](./TODO.md) 키스톤 · 원칙6

---

## 측정 대상

`gc.md`는 *런타임 컨텍스트 윈도우*의 엔트로피(대화 누적 노이즈)를 다룬다.
이 문서는 그 사촌 — *리포지토리 표면*의 엔트로피(시간이 지나며 드리프트한 죽은 파일·링크·중복)다.
원칙6의 "golden principles 정의 → 스캔 → 정리 PR"을 **우리 코드에 적용**한 것.

---

## GP-1 — relic 코드 디렉토리 (watch — advisory · **probation**)

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
- **probation 판정 (2026-06-03 재검토)**: 0/2 정밀도. 비해석 원칙(#010 §2)상 이 신호를 *더 똑똑하게*
  만드는 길(README 내용 파싱으로 signpost 판별)은 **금지된 추론**이다 — 구조 신호로 남을 수밖에 없고,
  구조 신호는 원리적으로 못 가른다. 따라서 **두 운명만 정당**: (a) 다음 적용에서 *진짜 relic 1건*을
  잡아 정밀도 >0 입증 시 watch 유지, (b) 다음 사이클에서도 또 거짓양성만 내면 **삭제**(GP-2의 dead-link이
  이미 "코드가 plugin으로 졸업" 사실을 cross-link 진부화로 더 정확히 잡으므로 GP-1 없이도 표면 GC 가능).
  현재는 (a)를 1사이클 더 기다리는 probation. 스캐너 출력에 `[probation]` 태그를 박아 *자기 의심*을 노출.

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

## GP-4 — 의미적 stale: 문서 주장 vs 코드 현실 (watch — **결정론 불가**)

**선언**: 문서가 *서술하는 상태*(예: "전부 미구현", "5개 구현", "N층 완성")가 *코드 현실*과
어긋나면 → semantic-stale. **이것은 결정론적 스캔이 원리적으로 못 잡는다** — 문서의 *의미*와
코드의 *의미*를 비교해야 하므로 dead-link(GP-2)처럼 경로 resolve로 환원되지 않는다.

- **근거 (#011 F2)**: `hooks/README.md`가 "모든 hook 미구현"이라 *역방향*으로 주장하나 실제 5개 구현.
  dead-link보다 나쁜 *적극적 오정보* — 에이전트가 "안 되어 있구나" 믿고 다시 만든다.
- **재검토 실증 (2026-06-03)**: canonical `plugin/harness/hooks/README.md` "백로그"가 `deploy kill-check`을
  *후보*로 남겨뒀으나 #005에서 이미 구현(같은 문서 본문에 spec 존재). 또 `rule-inject`(#012)가
  "현재 구현" 섹션에 미수록인데 hooks.json엔 wiring됨. 둘 다 결정론 스캔 사각.
- **탐지**: *스캐너는 자동탐지하지 않는다.* `gc-scan.py`의 `GP4_REVIEW_TARGETS`는 **사람/LLM이
  읽어야 할 지점의 체크리스트**를 watch로 *상기*시킬 뿐 — "이 문서의 주장이 코드와 맞나"를 사람이 본다.
- **처리**: GC 의식의 **mandatory 내용검토 단계**(아래 §내용검토 의식). 발견 시 *상태만* 정정(삭제 아님).
  high-confidence 아님 — fixpoint 0 요구 대상 아니다(내용 판단이 필요한 건 high-confidence가 아니다, #011 핵심).

## GP-5 — 아키텍처 복잡도 래칫 (watch — 측정만, 강제는 ratchet)

**선언**: `plugin/harness/{scripts,hooks}`의 *프로덕션* 코드(`*.py`/`*.sh`, `test-*` 제외) 수를 센다.
이 수는 cold-context 본인이 *재가동*해야 할 메커니즘 표면 = 아키텍처 엔트로피의 프록시(CA-11/PF-11).

- **근거**: 11+ 사이클이 매번 script/hook/축을 *더하기*만 하고 *빼기*가 없다(원칙7 boring-tech의
  아키텍처판 위반 — 의존성은 stdlib-only로 지켰으나 *구조*는 bespoke 단일사례 기계로 비대).
- **탐지**: `gc-scan.py --complexity-axis`가 수치 1줄 출력. 스캐너는 임계값으로 *판정하지 않는다*
  (임계 휴리스틱 = 금지된 추론). 그냥 수를 노출하고 ratchet에 잠그라 상기.
- **처리 (빼기 강제)**: 이 수를 ratchet 축 **`harness-mechanism-count` (lower_better)** 로 등재.
  새 메커니즘을 추가하는 사이클은 *은퇴 후보를 함께 지명*해 수를 비증가로 유지하지 않으면
  close 게이트가 회귀로 차단한다(#008 ratchet 재사용). 이로써 하네스가 *빼기*를 시작하게 강제.
- **현재값**: 23 (2026-06-03 재검토 기준). 이 값을 다음 사이클에서 floor로 잠그면 운영 시작.
  → *권고*(이 재검토에서 실행 안 함): 다음 사이클 bar.jsonl에 `axis=harness-mechanism-count,
  value=23, direction=lower_better` 등록. 원칙5 Sensor 은퇴와 묶어 *내려가는* 첫 값을 만들면 이상적.

---

## 내용검토 의식 (Mandatory Content Review — GP-4 절차)

GP-2까지는 결정론(경로 resolve)이라 스캐너가 끝낸다. **GP-1·GP-4는 사람이 읽어야 풀린다.**
GC를 돌릴 때 high-confidence fixpoint(자동)와 *별도로* 아래를 **반드시** 수행한다:

1. `gc-scan.py`의 GP-4 watch 항목 = 읽어야 할 문서 목록. 각 문서의 *상태 주장*을 코드와 대조.
2. "구현 상태"·"백로그"·"N개 구현"·"전부 미구현" 류 문장은 **전수 검증** — 코드 현실과 1:1 확인.
3. 불일치 발견 → *상태만* 정정(파일 삭제 아님). dead-link(GP-2)와 달리 자동 수선 불가.
4. GP-1 watch 항목 = 디렉토리 *내용을 직접 읽고* signpost↔relic 판정(자동 삭제 절대 금지, #011 F1).

이것이 `gc.md` §6.4("결정론적 우선, LLM/사람 판단은 최후")의 *표면 버전*이다.
결정론이 닿는 곳까지만 high-confidence, 나머지는 사람 — 그 경계가 곧 GP-2 ↔ GP-4의 선.

---

## high-confidence vs watch

- **high-confidence** (GP-2): 결정론적·명백·auto-actionable. *fixpoint 대상* — 정리 후 0이어야 함(B4).
  범위: draft 루트 + plugin/ 트리 양쪽 .md(2026-06-03 확장 — #011 F4 "GC 표면 확장").
- **watch** (GP-1, GP-3, GP-4, GP-5): 사람 판정 필요. GP-1=내용검토(signpost↔relic·probation),
  GP-3=R-CD04상 2까지 허용, GP-4=의미적 stale(결정론 불가, 사람검토 의식), GP-5=복잡도 측정(강제는 ratchet).
  fixpoint 0 요구 대상 아님(리포트만). **#011 교훈: 내용 판단이 필요한 건 high-confidence가 아니다.**

## 멱등 / fixpoint

정리 후 `gc-scan.py`를 재실행하면 high-confidence 항목이 **0**이어야 한다(또는 명시 whitelist).
이것이 GC가 *수렴*했다는 증거다. (`gc.md` §6.6 멱등성의 표면 버전.)
