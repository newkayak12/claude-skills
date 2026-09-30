# Devil's Advocate — 재검증 2: 4원칙(Think / Simplicity / Surgical / Goal-driven) 기준

작성 2026-09-30. 대상: 05-recheck의 "고친 방향" — ① 완성도 3층 정의 ② 스킬 6개 템플릿 섹션 채우기 ③ `freshness`
필드(해시 + `checked_at` + 재확인 주기) ④ 질문 3개 작은 게이트 ⑤ 항목별 합격선.

```
Position:   "완성도를 3층으로 정의하고 ②③④를 합격선과 함께 진행한다"
Steel-man:  저장소 규칙·생애주기·원칙 보존을 모두 지키면서, 비판에서 나온 결함을 검증 가능한 단위로 고친다.
```

## 숨은 가정
1. 05의 사실 주장(6/8 스킬이 섹션 1개뿐)이 맞다.
2. 사용자가 말한 "완성도"가 내가 정의한 3층과 같다.
3. `freshness`·작은 게이트가 필요하다는 근거가 있다.

## 반론 1: 05의 핵심 사실이 틀렸다 — 검증 없이 쌓았다 · execution · severity: critical  〔Think Before Coding〕
05는 `^## (Output Template|What Claude Does|Related)` 정규식으로 셌다. 실제 헤더를 보면 4개 스킬은 `Output Shape` /
`Output Options`로 출력 섹션이 **있다**. 실제로 빠진 것은:
- `What Claude Does / What You Do` — 6개(graph·query·ontology·rag·render·sqlite)
- `Process` — 2개(render-graph-view, sqlite-index-builder; 대신 Render/Build/Verify 단계 섹션 있음)
- 출력 섹션 — 2개(render-graph-view, sqlite-index-builder)

또 비교 대상인 다른 플러그인도 균일하지 않다(write:doc-coauthoring은 WCD/Related 없음). "저장소 기준 완성도의 가장 확실한
결함"이라는 05의 판정은 과장이었다. 틀린 수치 위에 1순위를 세운 것 — "Don't assume"의 정면 위반.
선례: 저장소 자체 — 00-baseline도 코퍼스를 "1개"로 단정했다가 조사로 뒤집혔다(knowledge-chat 4,168노트). 같은 세션에서 두 번째.

## 반론 2: "완성도"를 내가 정의했다 — 물었어야 했다 · assumption · severity: high  〔Think Before Coding〕
사용자는 "이게 완성도를 높이는 방향임?"이라고 물었고, 나는 3층 정의를 조용히 골랐다. 해석이 최소 셋이다:
(a) 저장소 규칙 준수(템플릿), (b) 사용자가 스킬을 써서 얻는 결과의 질, (c) 실제 운영 볼트(knowledge-chat)에서의 유지 가능성.
셋은 작업이 완전히 다르다. "If multiple interpretations exist, present them — don't pick silently."
선례: 원칙 문서가 겨냥하는 바로 그 실패 — 해석을 조용히 골라 구현 후 되돌림.

## 반론 3: ③④는 요청받지 않은 추측성 기능이다 · structural · severity: high  〔Simplicity First〕
- `freshness`(해시 + 날짜 + 재확인 주기)는 새 필드·새 설정값(주기)·두 판정 방식의 합성이다. 근거는 반론 1(05)의 논리뿐이고,
  **소스 없는 노트가 실제로 낡는지는 한 번도 측정되지 않았다.** 실측된 결함은 두 개뿐이다 — 큐 616줄 미소비, 코드와 어긋난 노트 정정.
  이 둘에 대한 최소 해법은 "소비자 없는 큐 쓰기를 멈춘다"(훅 수정 몇 줄)와 "소스 해시 비교"(검증기에 이미 `createHash` 있음)다.
- 질문 3개 게이트는 최소 경로(반론 2, 05)를 피하려고 만든 **대체 기능**이다. 아무도 요청하지 않았다. 기존 게이트는 질문 수 하한이
  없으므로 "3개로 시작해도 된다"는 문서 한 줄로 같은 효과가 난다.
"Would a senior engineer say this is overcomplicated?" — 예.
선례: YAGNI — 요청 전 일반화가 유지비만 남기는 잘 알려진 패턴.

## 반론 4: 템플릿 채우기 자체가 Surgical 기준을 넘을 수 있다 · execution · severity: medium  〔Surgical Changes〕
6개 스킬에 `What Claude Does / What You Do`를 추가하는 것은 추적 가능하다. 하지만 05가 함께 적은 "70% 길이 목표"를 끌어오면
동작하는 스킬 본문을 재작성하게 된다 — "Don't refactor things that aren't broken." 길이는 요청과 무관하다.
또 이 세션에서 서브에이전트 파일의 머리말을 sed로 고친 것처럼, 요청 밖 수정이 이미 한 번 있었다(버전 정정 — 사실 교정이라 정당하나 범위 확인 없이 했다).
선례: no clear precedent — speculative concern.

## 핵심 취약점
**검증하지 않은 사실과 묻지 않은 정의 위에 기능을 얹었다.** 반론 1(틀린 수치)과 반론 2(묻지 않은 해석)가 뿌리이고, 반론 3(추측성
기능)은 그 결과다 — 무엇을 고칠지 모르니 일반적인 장치(`freshness`, 작은 게이트)로 덮었다. 이 세션의 반복 패턴: 비판 → 계획 →
재비판마다 새 추상화가 붙고, 사실 확인은 매번 뒤늦게 온다.

## 가역성
reversible — 아직 코드 변경 0건. 지금 멈추면 비용은 문서뿐이다. 그래서 **더 설계하지 말고 확인부터** 하는 게 맞다.

## 개선 경로 (4원칙 적용)
1. **Think:** 사용자에게 완성도 해석 (a)/(b)/(c) 중 무엇인지 묻는다.
2. **Simplicity — 실측 결함 2개만, 최소 코드로:**
   - 큐: 훅이 소비자 없는 `*-queue.jsonl`을 쓰지 않게 한다 → verify: 훅 테스트 green + knowledge-chat에서 편집 후 큐 줄 수 불변.
   - 드리프트: 검증기에 `--check-stale`(노트 `sources:` 해시 비교) → verify: 픽스처 소스 1줄 변경 시 stale 1건, 무변경 시 0건.
3. **Surgical — 템플릿은 빠진 섹션만:** 6개 스킬에 `What Claude Does / What You Do` 표 추가, 본문 불변
   → verify: 8개 스킬 모두 헤더 존재 + `validate_plugins.py` 통과. 길이 재작성·섹션 이름 통일은 하지 않는다.
4. **Goal-driven:** 위 verify 줄이 곧 합격선. `freshness`, 작은 게이트, 3층 정의 문서화는 **폐기**.
5. 00·99의 "N=1", 05의 "6/8 섹션 1개" 서술을 사실대로 정정.
