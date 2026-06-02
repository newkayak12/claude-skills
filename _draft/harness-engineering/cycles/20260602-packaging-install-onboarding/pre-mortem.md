# Pre-mortem — packaging install onboarding

> "6개월 뒤 이 사이클이 *실패*했다고 가정. 왜 실패했는가?"
> 참조: [C-02 Pre-mortem](../../situational-rules/cognitive.md#c-02-pre-mortem-before-big-bet)

## 실패 시나리오 (≥5)

1. **Export drift** — `./harness`(빌드 산출물)를 누가 직접 고쳐서 draft(source)와 어긋남. 어느 게 진짜인지 모호해짐. 컨셉 문서가 두 곳에 중복.
2. **Self-containment 누락** — export가 일부 런타임 의존 문서를 안 담아, 설치 환경에서 `rules-load.py`/skill이 깨짐. 로컬 draft에선 cwd 덕에 통과돼 못 잡음(#007 SKIP 사각의 재판).
3. **install 대화가 작동 안 함** — skill은 만들었지만 실제 `~/.harness/user-rules.md` 생성이 멱등하지 않아 재실행이 기존 룰 파괴 / 또는 frontmatter 포맷 불일치로 `rules-load.py`가 파싱 거부.
4. **스코프 과대** — install + L1 + L2 project-rules + 작동 메커니즘 문서까지 한 사이클에 욱여넣어 한 세션 초과, 어느 것도 완성 못 함.
5. **CV-1 자기검증 편향** — author=user라 "동작한다"를 기계적 통과로 착각. 실제 새 머신 설치를 안 해봐 H1 유용성은 미검증인데 pass로 닫음.

## 가장 가능성 높은 1-2개

- 시나리오 2 (self-containment 누락) (가능성: 높음 — 로컬 cwd가 결함을 가림)
- 시나리오 1 (export drift) (가능성: 중 — 산출물/source 이원화의 구조적 비용)

## 사전 완화책

- 시나리오 2 → **hermetic export smoke test**: tmp 디렉토리로 export하고 `CLAUDE_PLUGIN_ROOT=<tmp>`로 잡아 draft cwd 오염 없이 런타임 스크립트 exit 0 검증 (#008 hermetic 패턴 재사용).
- 시나리오 1 → `./harness/README.md`에 "GENERATED — draft에서 export됨, 직접 편집 금지" 명시 + export 스크립트를 SSOT 메커니즘으로. (자동 drift 탐지는 backlog.)
