# Entropy GC — Re-review (엔트로피 GC 재검토)

**Date**: 2026-06-03
**대상**: #011 entropy-gc 산출물 — `gc-scan.py`(GP-1/2/3) + `GOLDEN-PRINCIPLES.md` + hermetic self-test + ratchet 축 2개
**트리거**: review/2026-06-03.md CA-11/PF-11 ("하네스가 자기가 GC하려던 엔트로피를 축적") + #011 retro 의심항목(GP-1 0/2 정밀도, 첫 패스 얕음)
**doer**: 본 재검토는 builder 가 직접 수행(독립 리뷰 분리는 orchestrator 통합 시). self-test 3-sabotage 로 비-vacuous 자가 입증.

> 비판 톤. "could improve" 필러 금지 — 무엇이 틀렸고 무엇을 했는지만. ID는 GP-id·#011 F-id·review CA/PF 에 결박.

---

## 0. 한눈에 — 정직한 판정표

| GP | 등급(전) | 판정 | 등급(후) | 근거 |
|---|---|---|---|---|
| GP-1 relic-dir | watch | **probation** (1사이클 더, 안 잡으면 삭제) | watch·probation | 0/2 정밀도, 비해석 원칙상 더 똑똑해질 길 없음 |
| GP-2 dead-link | high | **유지 + 표면 확장**(plugin/ 트리 포함) | high | 결정론·fixpoint 0·자동수선. 유일하게 high 자격 |
| GP-3 dup-parser | watch | **유지** | watch | R-CD04 Rule-of-Three, 2멤버 = 정상 watch |
| GP-4 의미적 stale | (없음) | **신규 선언** — 결정론 불가, 사람검토 의식 | watch | #011 F2 역방향 stale 은 스캔 사각, 의식으로 포착 |
| GP-5 복잡도 래칫 | (없음) | **신규 선언** — 측정만, 강제는 ratchet | watch | CA-11/PF-11 "빼기 없는 더하기" 차단 |

**핵심 한 줄**: 결정론이 닿는 곳(GP-2)만 high-confidence, 나머지는 watch + 사람 의식. #011 교훈("내용 판단이 필요한 건 high-confidence가 아니다")을 신규 GP-4/5 로 *구조화*했다.

---

## 1. 현재 상태 평가 — GP-1/2/3

### GP-1 (relic 디렉토리) — **probation. 진짜 relic 1건 못 잡으면 다음 사이클에 삭제** [#011 F1]

**무엇이 틀렸나**: 휴리스틱(README-only + 코드0 + canonical 존재)이 0/2 정밀도였다. `scripts/`·`hooks/`
둘 다 *살아있는 signpost*인데 relic 으로 탐지됐다. 이건 튜닝으로 못 고친다 — **구조 신호는 signpost↔relic을
원리적으로 못 가른다.** 살아있는 안내문도, 죽은 잔재도 둘 다 "README만 있고 코드는 canonical에" 다.

**(a) 샤프닝 vs (b) 강등 — 증거 기반 결정**: 샤프닝의 *유일한* 길은 README 내용을 파싱해 signpost 마커
("코드 위치 안내", "도구 추가 기준")를 찾는 것이다. 그러나 그건 **금지된 추론**(#010 §2 비해석 원칙) — GP는
선언이지 내용 추측이 아니다. 따라서 GP-1은 구조 신호로 남을 수밖에 없고, 구조 신호는 못 가른다. 결론:
- **샤프닝 불가**(원칙 위반 없이는).
- **즉시 삭제도 성급**: 코드가 plugin으로 *졸업한* 디렉토리가 실제로 *방치된 채 stale*해질 미래는 있다.
  그때 GP-1이 첫 진짜 양성을 낼 수 있다. 그 가능성에 1사이클 유예.

**판정: probation.** 스캐너 출력에 `[probation: 0/2 정밀도]` 태그를 박았다(자기 의심을 표면에 노출 —
"엔트로피 잡는 도구가 자기 헤더에 엔트로피" F5의 정신을 *findings 텍스트*로 확장). 다음 적용에서 진짜
relic 1건을 잡으면 watch 유지, 또 거짓양성만 내면 **GOLDEN-PRINCIPLES에 적힌 대로 삭제** — GP-2의
dead-link이 이미 "졸업한 디렉토리의 cross-link 진부화"를 *더 정확히* 잡으므로 GP-1 없이도 표면 GC는 성립.

### GP-2 (dead-link) — **유지가 정당. 유일한 high-confidence. 단 #011은 표면이 얕았다** [#011 F4]

**무엇이 약했나**: 첫 패스의 high 4건이 *전부 1 root cause*(없는 `templates/retro.md`를 3파일이 4회 링크).
바 "≥4 위반"의 문자는 충족했으나 "4개 *구별된* 문제"의 정신은 약했다(F4). 그리고 더 큰 사각: **GP-2가
`plugin/` 트리 전체를 스킵했다** — plugin SKILL.md·README의 상대링크는 한 번도 검사된 적이 없다.

**무엇을 했나**: GP-2 스캔 범위를 `plugin/` 트리 .md 까지 확장(아래 §3.1). 결정론·high-confidence 자격
유지(경로 resolve 로 환원되므로). 현재 실repo에서 plugin/ 상대링크는 1건뿐이고 resolve 정상 → **거짓양성 0**.

### GP-3 (중복 파서) — **유지. 손댈 것 없음**

`l0-parser` 그룹 2멤버 = R-CD04 Rule-of-Three상 정상 watch. 3번째 L0 파서 등장 시 ESCALATE 로직 정상.
재검토에서 새 중복-우려 그룹은 발견 못함(다른 파서들은 서로 다른 아티팩트 파싱 — 동일축 중복 아님).

---

## 2. 알려진 갭 처리

### 2.1 GP-1 정밀도 (#011 F1) → §1 GP-1 참조. **probation + 자기의심 태그.**

### 2.2 얕은 첫 패스 (#011 F4) → **표면 3축 확장**

TODO "GC 표면 확장"의 3축을 평가:

| 축 | 결정론적? | 처리 |
|---|---|---|
| **plugin SKILL.md 상대링크** | ✅ (경로 resolve) | **구현** — GP-2 범위에 plugin/ 포함. high-confidence. |
| **문서 토큰 비대** | △ (측정은 결정론, 판정은 아님) | **별도 도구 위임** — `token-profile.py`가 이미 *주입* 표면을 잼. 문서 비대는 P2(TODO)에서 "문서는 이미 lean" 감사 완료 → gc-scan에 *중복 구현 안 함*(GP-3 정신: 중복 회피). |
| **미빌드 hook spec** (hooks/README "전부 미구현"인데 5 빌드) | ❌ (의미적) | **GP-4로 선언** — 결정론 스캔이 *원리적으로 못 잡음*. 사람검토 의식으로. |

→ 결정론으로 환원되는 것(링크)만 gc-scan에 넣고, 측정 중복(토큰)은 기존 도구에 위임, 의미적인 것은 GP-4.

### 2.3 의미적 stale (#011 F1/F2) → **GP-4 신규 선언 + mandatory 내용검토 의식**

**문제의 본질**: 결정론적 스캔은 "doc claims X vs code reality Y"를 *원리적으로* 못 잡는다. 문서의 *의미*와
코드의 *의미*를 비교해야 하므로 경로 resolve로 환원 불가. 이건 코드가 아니라 **프로세스**로 푸는 문제다.

**무엇을 했나**:
1. **GP-4 선언**(GOLDEN-PRINCIPLES.md): "문서 주장 vs 코드 현실" 패턴을 watch GP로 명문화.
2. **gc-scan은 자동탐지하지 않는다** — `GP4_REVIEW_TARGETS` 체크리스트(읽어야 할 지점)를 watch로 *상기*만.
   3개 타깃: hooks/README 구현상태·SKILL.md 명령인터페이스·README/13의 "N개 구현" 수치주장.
3. **mandatory 내용검토 의식**을 GOLDEN-PRINCIPLES §내용검토 의식 + gc.md §6.5에 명문화 — 스캔(결정론) →
   high fixpoint(자동) → **GP-4 체크리스트 전수 검토(사람/LLM)** 의 3단 절차.
4. **fresh 실증 정정**: 재검토 중 GP-4가 실제로 작동 — canonical `plugin/harness/hooks/README.md`
   "백로그"가 `deploy kill-check`을 *후보*로 남겨뒀으나 #005에서 이미 구현(같은 문서 본문에 spec). 정정함.
   (병렬로 `rule-inject`/`stage-inject` 도 "현재 구현" 수록 일관성 점검 대상 — GP-4 타깃이 정확히 이 파일을 가리킴.)

**경계 명시**: high-confidence(GP-2: 결정론·auto-actionable·fixpoint→0) ↔ watch(GP-1/3/4/5: 내용 판단
필요, fixpoint 요구 아님). 이게 #011의 핵심 교훈을 GP 등급 체계로 *구조화*한 것.

### 2.4 PF-11/CA-11 — 아키텍처 엔트로피 → **GP-5 복잡도 래칫 신규 선언 + 구현**

**문제**: 하네스가 11+ 사이클에 ~23개 프로덕션 스크립트/훅으로 비대. 원칙7(boring-tech)은 *의존성*에선
지켰으나(stdlib-only) *구조*에선 위반 — author만 이해하는 bespoke 단일사례 기계. 매 사이클이 *더하기*만.

**무엇을 했나 (clean 하게 구현 가능 → 구현)**:
- **GP-5 선언** + `count_complexity()` 스캐너: `plugin/harness/{scripts,hooks}`의 프로덕션 `*.py`/`*.sh`
  수(`test-*` 제외 — 테스트는 메커니즘이 아니라 그 검증). `gc-scan.py --complexity-axis` → 수치 1줄.
- **현재값 23.** 스캐너는 *판정 안 함*(임계 휴리스틱 = 금지된 추론) — 수만 노출하고 ratchet에 잠그라 상기.
- **빼기 강제 메커니즘**: 이 수를 #008 ratchet 축 **`harness-mechanism-count` (lower_better)** 로 등재하면,
  새 메커니즘 추가 사이클은 은퇴 후보를 함께 지명해 수를 비증가로 유지하지 않으면 close 게이트가 회귀 차단.

**남긴 것(이 재검토에서 *실행 안 함* — orchestrator/사용자 결정)**: 실제 bar.jsonl 등록
(`axis=harness-mechanism-count, value=23, direction=lower_better`)은 *사이클 산출물* 등록이라 활성 사이클
맥락이 필요하다. 다음 사이클에서 원칙5 Sensor 은퇴와 *묶어* 23→(더 낮은 값)으로 잠그면 "빼기"의 첫 실증.
지금 23을 무맥락으로 잠그면 floor만 서고 빼기는 강제 안 됨 — 그래서 *권고로만* 남김.

### 2.5 원칙5 — 모델 교체(Opus 4.8) Sensor 재검증: **트리거 발생했으나 미실행 — 구체 후보 surfacing**

TODO는 원칙5를 "다음 모델 업글이 트리거"로 Watch에 두지만 **레포는 이미 Opus 4.8** — 트리거는 *이미*
발생했다. 전체 재검증(주요 태스크 3개 전/후 비교)은 이 재검토 범위 밖이라 안 했으나, **은퇴 후보를 지명**한다:

| Sensor (이벤트) | 4.8 은퇴 후보? | 판단 |
|---|---|---|
| `hypothesis-immutability` (PreToolUse 차단) | **아니오 — 유지** | author=enforcer=target 방어는 *모델 능력*이 아니라 *물리적 잠금*. 모델이 똑똑해져도 자기편향은 안 사라짐(CV-1/CV-2). 모델 무관. |
| `active-symlink-guard` (PreToolUse 차단) | **아니오 — 유지** | 종료 경로 물리 강제. 모델 능력과 직교. |
| `active-cycle-verify` (SessionStart 탐지) | **후보 ✓ (약)** | PreToolUse 사각(세션 밖 편집) 보강용. 4.8이 더 일관되게 정당 경로를 쓰면 *탐지 빈도→0*에 수렴할 수 있음. **관측 권고**: N사이클 탐지율 0이면 은퇴 검토. (지금 삭제는 성급 — 변조는 모델 아닌 *사람/외부도구*가 함.) |
| `session-counter` (SessionStart 측정) | **아니오 — 유지** | kill-check 데이터 공급. 모델 무관 인프라. |
| `deploy-kill-check` (UserPromptSubmit 차단) | **후보 ✓ (약)** | sunk-cost 밀어붙이기 방어. 4.8이 *스스로* kill 신호를 더 잘 인지하면 hook의 한계가치↓. 단 *인지≠행동*(AP-10은 알면서도 미는 것) → **유지 권고**, 단 효과측정(차단 빈도) 관측. |

**가장 강한 후보**: `active-cycle-verify` — *탐지*형이라 "4.8이 변조를 안 일으켜 탐지율 0"이 측정되면 가장
정당하게 은퇴 가능. 단 변조원이 *모델*만이 아니므로(에디터 직접편집·외부도구) 즉시 삭제 아님 — **관측 후 판단**.
이 관측 자체가 GP-5 복잡도 래칫이 요구하는 "은퇴 후보"의 첫 공급원이 된다(2.4와 결합).

---

## 3. 변경/구현 내역

### 3.1 `plugin/harness/scripts/gc-scan.py`
- **GP-2 표면 확장**: `plugin/` 트리 .md 도 스캔(이전 전체 스킵). `cycles/`·`.git`·`situational-rules`·
  `__pycache__`만 제외. 거짓양성 0(실repo plugin/ 상대링크 1건 resolve 정상).
- **GP-4 신규**(`gp4_review_reminders()` + `GP4_REVIEW_TARGETS`): 의미적-stale 사람검토 체크리스트를
  watch로 노출. *자동탐지 아님* — 읽어야 할 지점만 상기.
- **GP-5 신규**(`scan_gp5_complexity()` + `count_complexity()`): 메커니즘 수 측정, `--complexity-axis` CLI.
  `test-*` 제외. 임계 판정 안 함(추론 금지).
- **GP-1 probation 태그**: findings 텍스트에 `[probation: 0/2 정밀도]` 박음.
- docstring/help 갱신(GP-1~5).

### 3.2 `plugin/harness/scripts/test-gc-scan.sh`
- GP-2 plugin/ 확장 검증: plugin 내부 dead-link `missing-skill.md`가 high로 잡힘(거짓음성0) +
  실존 `skill_real.md`는 안 잡힘(거짓양성0). fixpoint 수선을 draft+plugin 2건으로 확장.
- GP-4 검증: `semantic-review` watch 출력 + GP-4/high 부재(결정론 불가→watch 강제).
- GP-5 검증: `mechanism-count` watch + `--complexity-axis` 값 = 2(test-*.sh 제외 확인).
- **비-vacuous 입증(3 sabotage 재현)**: ①plugin 스킵 복원→plugin dead-link 테스트 FAIL,
  ②test-* 제외 제거→axis 값 FAIL, ③GP-4 severity high화→watch 테스트 FAIL. 전부 정확히 깨짐.

### 3.3 `GOLDEN-PRINCIPLES.md`
- GP-1 probation 판정 명문화(샤프닝 불가 근거 + 삭제 조건).
- GP-4·GP-5 선언 추가(비해석 원칙 준수 — 선언 먼저, 스캔 나중).
- **내용검토 의식** 섹션 신설(GP-4 4단 절차).
- high-confidence vs watch 표 갱신, 헤더 GP-1~5 반영.

### 3.4 `gc.md`
- **§6.5 표면 엔트로피 GC** 신설 — 런타임(§1~6)의 *사촌*으로 명시. 런타임↔표면 대응표, 결정론↔사람
  경계(GP-2↔GP-4 선), 의미적 stale = 적극적 오정보(#011 F2), "GC조차 자기검증 필요"(#011 F1).

### 3.5 `plugin/harness/hooks/README.md`
- 백로그의 `deploy kill-check`(이미 #005 구현)을 정정 — GP-4 의식이 잡은 첫 실repo 정정.
  *(이후 병렬 에이전트의 stage-inject 추가로 일부 재조정됨 — 통합 시 GP-4 재점검 권고.)*

---

## 4. 테스트 결과

```
bash plugin/harness/scripts/test-gc-scan.sh   →  gc-scan self-test: PASS
gc-scan.py --high-confidence-only             →  OK: high-confidence 엔트로피 0 (fixpoint), exit 0
gc-scan.py --complexity-axis                  →  23
```

- 신규 self-test 어서션 **3종 추가**(GP-2 plugin 확장·GP-4·GP-5), 전부 sabotage로 비-vacuous 입증.
- 실repo high-confidence **fixpoint 0 유지** — 확장이 거짓양성 0임을 확인(하드 제약 충족).

---

## 5. 실행 안 함 — orchestrator/사용자 결정 대기

1. **GP-5 ratchet 축 실제 등록** (`harness-mechanism-count=23, lower_better`): 활성 사이클 bar.jsonl 등록
   필요. 다음 사이클에서 원칙5 Sensor 은퇴와 묶어 *내려가는* 첫 값으로 잠그길 권고(무맥락 잠금은 floor만 서고
   빼기 강제 안 됨).
2. **원칙5 전체 재검증** (주요 태스크 3개 4.8 전/후 비교): 범위 밖. 본 재검토는 *후보 surfacing*까지 —
   가장 강한 은퇴 후보 = `active-cycle-verify`(탐지율 관측 후), 약 후보 = `deploy-kill-check`(효과측정 후).
3. **GP-1 운명 결정**: probation 1사이클. 진짜 relic 1건 못 잡으면 GOLDEN-PRINCIPLES 명시대로 삭제.
4. **CA-8/CV-2(외부 측정 부재)**: 본 재검토는 *표면·아키텍처 엔트로피*만 다룸 — 북극성("품질 저하") 외부
   측정(PF-8)은 별개 최우선 과제로 review/2026-06-03.md에 그대로 남음. GP-5는 *복잡도* 프록시일 뿐
   *품질* 프록시 아님 — Goodhart 경계 명시.

---

## 6. 정직한 균형

이 재검토가 *부정하지 않는 것*: GP-2 dead-link은 진짜 결정론적 가치가 있고 fixpoint 게이트는 작동한다.
이 재검토가 *주장하는 것*: #011은 "측정기 자체가 틀릴 수 있다"(GP-1 0/2)를 발견했고, 그 교훈을 신규
GP-4/5로 *구조화*해 결정론↔사람 경계를 GP 등급으로 못박았다. 단 — GP-5는 *복잡도를 측정*할 뿐
*빼기를 강제하지 않는다*(ratchet 등록이 별도 필요). 그리고 가장 깊은 갭(CA-8: 품질 자체를 외부 측정한 적
없음)은 *이 재검토로도 안 닫힌다* — 표면을 아무리 깨끗이 GC해도 "하네스가 품질 저하를 막는다"의 외부
증거는 여전히 0이다. GP-5의 메커니즘 수 23이 *내려가기 시작할 때* 비로소 "빼기"가 설계의도에서 사실이 된다.

---

## 처리 로그 — 2026-06-03 (사람/LLM 내용검토 1회, GP-4 의식 실행)

gc-scan 실행 → high-confidence **0 (fixpoint, 자동정리 대상 없음)** + watch 8건. watch는 사람 판정이라 아래 직접 처리:

| GP | 항목 | 판정 | 행동 |
|---|---|---|---|
| GP-4 | `hooks/README.md` 구현상태 | **stale 실재** — "#002~#008 5개 Sensor"인데 실제 7개(rule-inject·stage-inject 누락), `hook-stage-rules`가 `[ ]`인데 stage-inject.py로 이미 구현 | **수정**: "7개(Sensor 5+주입 2)", rule-inject·stage-inject `[x]` 추가, hook-stage-rules→stage-inject.py 체크오프 + 미구현목록 중복 제거 |
| GP-4 | `SKILL.md` 명령/플래그 | 검토함 — install SKILL Step4 표가 stage-inject 두 시점 반영(병렬 작업서 갱신됨). 일치 | 무행동 |
| GP-4 | `README.md`·`13` 수치주장 | 검토함 — "N층/X개" 수치 grep 0건(서술형만). stale 없음 | 무행동 |
| GP-1 | `hooks/` `scripts/` relic 후보 | **여전히 signpost** (canonical plugin 위치 안내 + 살아있는 가이드, #011 판정 유지). probation 계속 | 유지(삭제 안 함) |
| GP-2 | `templates/adr.md` dead link | placeholder/whitelist(역사적) | 무행동 |
| GP-3 | `l0-parser` dup 2멤버 | R-CD04 Rule-of-Three 전 — watch 허용 | 무행동 |
| GP-5 | mechanism-count **23** | 복잡도 워터마크. *빼기*는 원칙5 증거(detection-rate→0) 필요 — 증거 없이 작동 Sensor 삭제는 무모(CV-2식 미측정 행동). 축 lock은 bar-register(active 사이클)로 | **defer**: 23을 watermark로 잠그는 `harness-mechanism-count`(lower_better) 축 등재는 다음 close에. 은퇴 후보(active-cycle-verify, deploy-kill-check)는 측정 후 |

**결론**: 표면 엔트로피 *처리 가능분*은 정리됨(GP-4 stale 1건 수정, high-confidence fixpoint 0 유지). 구조 엔트로피(GP-5 23)는 *측정 없는 빼기를 거부* — 잠금/은퇴는 증거를 갖춘 사이클로. 가장 깊은 CA-8(외부 품질 측정)은 GC 범위 밖, 여전히 0.
