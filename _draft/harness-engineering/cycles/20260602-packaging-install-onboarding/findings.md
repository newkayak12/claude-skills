# Dogfood Findings — packaging install onboarding

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | gate(D) | 게이트가 패키징 블로커를 *빌드 전에* 잡음 — 플러그인이 self-contained 아님(컨셉 문서가 plugin 밖 draft 루트, `rules-load.py`는 plugin 루트에서 06-rules.md 기대) | high | export 단계 신설(컨셉 문서 평탄화)로 해소. self-containment를 hermetic smoke로 강제 |
| F2 | review | **`rules-load.py`가 실제 06-rules.md에서 룰 0개 파싱** — 헤더가 `### R-`(H3)인데 정규식은 `## `(H2)만, 게다가 per-rule Stage 태그가 아니라 *섹션 단위 로딩시점*. 한 번도 동작 안 한 코드. 설치 스킬이 이 기능을 광고 | high | 파서를 실제 구조(H2 섹션 로딩시점 → H3 룰 상속)로 재작성. test에 '>0 룰' non-vacuous 단언 추가 |
| F3 | review | 빌더 `harness-export.py`가 export 산출물에 실려 inert/위험(거기선 parents[5]→/home). 독립 리뷰어 F2 | medium | export EXCLUDE_NAMES에 빌더+그 테스트 추가 → 산출물에서 제외 |
| F4 | review | install 스킬이 "rules-load가 stage 룰 + **L1 user-rules** 적용"을 과대광고 — rules-load는 L0(06-rules.md)만 로드. L1/L2/L3 머지 엔진 미배선 | medium | 스킬 표 한 줄 정직화(L0만 로드 명시). 룰-레이어링 엔진은 backlog |
| F5 | build | 컨셉 문서가 두 곳(draft source + ./harness 산출물)에 중복 — export drift 위험(pre-mortem #1) | medium | ./harness/README.md + `.harness-export` 마커에 "GENERATED, 직접편집 금지" 명시. 자동 drift 탐지는 backlog |
| F6 | review | 룰 포맷 3종 불일치 — 12-layering §3(YAML frontmatter) vs §5(H2+Layer:) vs 06-rules(H3+섹션 로딩시점). user-rules-init은 §5, rules-load는 06-rules식 | low | finding만. 룰-레이어링 엔진 사이클에서 SSOT 포맷 1개로 수렴 필요(backlog) |
| F7 | review | user-rules-init이 `~/.harness/user-rules.md`에 `../12-rule-layering.md` 상대링크 기록 → home 기준 깨짐 | low | 링크 제거, 텍스트 참조로 변경 |

## 살아있는 로그

- cycle-init을 draft 루트 cwd에서 실행해 F1(#008) 재현 회피 — 단 cwd 의존은 여전(백로그 유지).
- export 설계 결정(top-level ./harness, draft=source)은 사용자 결정. self-containment는 "런타임 하드 의존은 06-rules.md 하나"라는 grep 분석에 근거해 컨셉 문서 전체를 boring하게 담는 쪽 선택(원칙7).
- 독립 리뷰어가 5/5 pass를 주면서도 진짜 갭 2건(F2 vacuous, F3 빌더)을 포착 — 원칙3(생성≠평가)이 또 값을 입증. 빌더로서 직접 빌드 후 fresh subagent 리뷰만 분리.
- **F8 (verification-before-completion이 잡음)**: F2 파서 재작성에서 `STAGE_RE`를 지웠으나 `print_rule`이 여전히 참조 → `--all`/`rules-load <stage>`가 첫 룰 출력 후 `NameError` 크래시. `--list-stages`(print_rule 미사용)와 export 테스트의 `>0` 단언(크래시 직전 1개)이 *vacuous하게* 통과시켜 놓침. 최종 검증에서 `--all` exit code를 직접 보고 발각 → `print_rule` 수정(섹션 stage라 body skip 불필요) + 테스트를 'exit 0 & 룰>5 & stage필터 완주'로 강화(스트리밍 grep은 크래시 못 잡음). 교훈: *self-contained 스모크는 "존재"가 아니라 "끝까지 동작"을 봐야* (F2의 재발).
