# Dogfood Findings — entropy gc

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | build | **구조적 relic 탐지기(GP-1)가 signpost↔relic을 못 가른다** — "README+코드0+canonical존재"로 2건 탐지(`scripts/`·`hooks/`) → **0건이 안전 삭제 대상**. `scripts/README.md`는 살아있는 가이드("설계 원칙(유지)"·"도구 추가 기준")인 *의도적 signpost*, `hooks/README.md`는 16-hook 설계 카탈로그(삭제 불가, 상태만 stale). 휴리스틱 정제(canonical에 README존재 등) 시도해도 전부 거짓양성 | high(설계) | **GP-1을 high-confidence→watch 강등**. 내용 판단 필요한 건 high-confidence 아니다(자동삭제 금지). GOLDEN-PRINCIPLES.md에 실증 기록. #009 F1·#010 F1과 동형(실적용 전엔 맞아 보이는 탐지기) |
| F2 | build | **hooks/README.md "구현 상태"가 역방향 stale** — "모든 hook spec만, 미구현"이라 주장하나 #002~#008에서 **5개 구현됨**. 문서가 현실과 *반대*를 주장(dead link보다 나쁜 적극적 오정보). canonical `plugin/harness/hooks/README.md`(112줄, 정확)가 이미 SSOT인데 draft-root 카탈로그(280줄)가 진부화 | medium | 구현 상태 섹션 정정(5개 `[x]` + canonical 포인터). *이 entropy는 결정론적 스캔이 못 잡음* — 의미적 드리프트. 사람 내용검토(GC 의식의 mandatory review)가 포착 |
| F3 | build | **약속됐으나 없는 산출물: `templates/retro.md`** — 07·08·11 3개 개념문서가 "회고 양식"으로 4회 링크하나 파일 부재(GP-2 high ×4). 죽은 약속 | low | `templates/retro.md` 생성(cycle-init RETRO 템플릿 미러, templates/ 깊이에 맞춘 링크). 4개 dead link 동시 해소 |
| F4 | review | **B2 "≥4 위반"이 thin** — high-confidence 4건이 *같은 타깃*(./templates/retro.md) 1 root cause를 3파일이 4회 링크한 것. 바 문자(≥4 탐지·actioned)는 충족하나 정신(4개 *구별된* 문제)은 약함. 1 수정(retro.md)으로 전부 해소 | low | finding. 바는 정직히 충족(게이밍 아님)이나 GC 첫 패스가 *얕다*는 신호. 다음 GC는 더 넓은 표면(plugin SKILL.md 링크·문서 비대·토큰)으로 |
| F5 | review | **gc-scan.py 자신의 docstring drift** — :5가 `GP-1 ... [high]`인데 코드·self-test·GOLDEN-PRINCIPLES는 watch. *엔트로피 잡는 도구가 자기 헤더에 엔트로피*(아이러니) | low | 즉시 수정([watch]). + `--root` 미존재 raw FileNotFoundError → 깨끗한 exit1. 둘 다 리뷰어 포착 |
| F6 | build | **rules-load --all은 exported 맥락에서만 동작** — 소스 트리 직접 실행 시 `06-rules.md not found`(plugin/harness/06-rules.md 기대, 소스는 draft 루트). 기존 draft-vs-export 설계(#009)지 #011 회귀 아님 | low(기존) | B3 measure를 *exported 맥락*으로 해석(harness-export self-test가 그 경로로 45룰 검증). standalone 소스 실행은 설계상 미지원 — TODO export-drift 항목과 연결 |

## 살아있는 로그

- **GC를 *우리 코드에 처음* 적용**(원칙6 "golden principles 정의→스캔→정리 PR"). 산출물: `gc-scan.py`(결정론적 스캐너, 반복가능)+`GOLDEN-PRINCIPLES.md`(선언)+hermetic self-test. ratchet 축 2개 등록(`harness-entropy-found`↑·`harness-entropy-remaining`↓) → 미래 사이클이 엔트로피 재유입 시 close 게이트가 차단.
- **핵심 교훈(F1)**: 결정론적 표면 스캔은 *dead link*(GP-2) 같은 명백한 것만 high-confidence 자격. *signpost↔relic*, *의미적 stale*(F2)은 사람 내용검토 필요 → watch. "내용 판단이 필요한 건 high-confidence가 아니다." 이게 gc.md §6.4("결정론적 우선, LLM/사람 판단은 최후")의 표면 버전.
- 독립 리뷰어가 self-test에 3개 sabotage(_strip_code no-op·resolve 강제 False·GP-1 severity 뒤집기)를 주입해 전부 잡힘을 확인 → 비-vacuous 입증. #009 F8(vacuous self-test) 교훈이 이번엔 *선제적으로* 작동.
- WET 파서(`ruleslib.parse_l0`↔`rules-load.parse_rules`)는 GP-3 watch(2멤버, R-CD04 Rule of Three 미달) — 통합 안 함. 3번째 L0 파서 등장 시 ESCALATE.
