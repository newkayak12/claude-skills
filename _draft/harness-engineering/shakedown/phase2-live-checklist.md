# Phase 2 LIVE — 진짜 설치 + 라이브 세션 체크리스트 (F1 닫기)

> **이게 닫는 것**: 시운전의 *결정적* 질문 — claude 런타임이 hook을 **실제로 발화**시키고 스킬을
> **실제로 트리거**하는가(H1·#005). 격리 구동(`review/2026-06-04-shakedown-result.md`)은 스크립트를
> *직접 호출*해 통합층만 봤다. 여기선 **아무 스크립트도 직접 부르지 않는다** — 설치하고, 세션을 열고,
> *저절로 일어나는 것만* 본다. 직접 호출하면 측정이 오염된다.
>
> **별도 터미널에서 당신이 구동.** 각 단계 [관측]을 직접 본 것만 채운다. 못 봤으면 SILENT.

---

## 0. 사전 (1회)

```bash
command -v claude && command -v python3            # 둘 다 있어야
python3 -m pip install --quiet pytest fastapi      # F3 해소 — 토이 과제 진짜 green 증거용
ls /home/newkayak12/projects/claude-skills/harness/.claude-plugin/plugin.json   # export 존재 확인
```
- [ ] claude·python3 OK · pytest/fastapi 설치 · export 플러그인 존재

## A. 플러그인 설치 (로컬 marketplace)

claude 세션 안에서(아무 디렉터리):
```
/plugin marketplace add /home/newkayak12/projects/claude-skills
/plugin install harness@newkayak12-claude-skills
```
- 설치 중 **hook 승인 프롬프트**가 뜨면 승인(harness는 SessionStart/PreToolUse/UserPromptSubmit hook을 건다).
- 끝나면 claude 재시작(또는 지시대로).
- [ ] [관측] 설치 성공 메시지 · hook 승인했나

## B. 배선 검증 — *신뢰 전에 확인* (여기가 F1의 절반)

```
/plugin          → harness 가 enabled 로 보이나?
/hooks           → SessionStart 에 rule-inject/active-cycle-verify/session-counter,
                   PreToolUse 에 hypothesis-immutability/stage-inject 가 *실제 등록*돼 보이나?
```
- [ ] [관측] `/plugin`에 harness enabled
- [ ] [관측] `/hooks`에 harness hook들이 **런타임에 등록됨** ← 이게 안 보이면 *플러그인이 hook을 안 싣는다*는 **진짜 발견**(plugin.json에 hooks 선언/자동탐지 갭). 여기서 멈추고 기록.
- [ ] [관측] 스킬 목록에 `harness:install`·`harness:cycle` 노출 (`/help` 또는 스킬 자동완성)

> B에서 빨강이면 C~G의 자동발화는 어차피 안 일어난다 — **배선이 F1의 첫 관문**. 빨강이면 그것만 적고 보고.

## C. 빈 디렉터리 + 새 세션 — rule-inject 런타임 발화 (결정적 #1)

```bash
mkdir -p /tmp/harness-live && cd /tmp/harness-live && claude
```
세션이 *열리는 순간* 컨텍스트를 본다(스크롤업).
- [ ] [관측] `[harness] 항상-켜둘 룰 자동 주입 …` 경계가 **내가 아무것도 안 했는데** 떴나?
  - 떴으면 → **FIRED(런타임)**. 첫 줄 인용해 기록.
  - 안 떴으면 → **SILENT(런타임)**. (격리구동에선 FIRED였으니, 차이=런타임 미발화=진짜 발견)

## D. harness:install 스킬 런타임 트리거 (S2)

새 세션에 자연어로:
```
harness 방금 깔았어. 초기 설정 도와줘.
```
- [ ] [관측] claude가 `harness:install` 스킬을 **자동 호출**했나(스킬 실행 표시)? 아니면 그냥 일반 답?
- [ ] [관측] 대화로 user-rules를 묻고 `~/.harness/user-rules.md`를 *스크립트로* 생성했나(수동 작성 아님)

## E. harness:cycle 런타임 트리거 + scaffold (S4 일부)

```
이 디렉터리에서 새 사이클 시작하자. GET /health 엔드포인트 하나 만드는 dev-tool 사이클.
```
- [ ] [관측] `harness:cycle` 스킬 자동 호출 → pre-cycle 게이트를 *대화로* 진행했나
- [ ] [관측] Go 판정 후 `cycles/<id>/` 가 **이 CWD에** 생겼나 (`ls cycles/`)

## F. stage-inject + hypothesis-immutability 런타임 발화 (결정적 #2)

사이클 안에서 claude에게 코드를 짜게 한다:
```
app.py 에 FastAPI GET /health → {"status":"ok"} 작성하고 pytest 테스트도 만들어줘.
```
- [ ] [관측] claude가 첫 Edit/Write 하는 순간 `[harness] 단계 진입 룰 자동 주입 (stage: code-writing)` 이
      **모델 컨텍스트에 들어왔나**(stage-inject 런타임 발화). claude의 행동/언급으로 확인.
- [ ] [관측] pytest 실제 실행 → green 로그(F3 증거).

그다음 **변조를 claude에게 시켜본다**(차단 hook 런타임 발화):
```
cycles/active/hypotheses.jsonl 파일 안의 글자 하나만 직접 고쳐서 저장해줘.
```
- [ ] [관측] `hypothesis-immutability` 가 그 Edit를 **런타임에 차단**(exit2)했나 — claude가 "차단됐다"고 보고하나?
  - 차단 → **BLOCKED-OK(런타임)**. 안 막힘 → 진짜 발견(hook 미발화).

## G. close 게이트 (S4 나머지 — 런타임은 스킬이 스크립트를 부르는지)

```
이제 사이클 닫자. (리뷰 없이 먼저 시도해봐)
```
- [ ] [관측] 무리뷰 close가 차단됐나 → 독립 리뷰(다른 관점) 거쳐 정상 close 됐나
- (ratchet은 단일 사이클이라 floor 없음 — 격리구동에서 이미 BLOCKED-OK 확인됨, 여기선 생략 가능)

## H. RUNTIME BLACKBOX — 격리구동과 대조

| 기계장치 | 격리(직접호출) | **런타임(이번)** | 일치? |
|---|---|---|---|
| rule-inject (SessionStart) | FIRED | _C_ | |
| harness:install 스킬 트리거 | (해당없음) | _D_ | |
| harness:cycle 스킬 트리거 | (해당없음) | _E_ | |
| cycle-init scaffold | FIRED | _E_ | |
| stage-inject (첫 Edit) | FIRED | _F_ | |
| hypothesis-immutability | BLOCKED-OK | _F_ | |
| close 리뷰 게이트 | BLOCKED-OK | _G_ | |

**F1 판정**: 런타임 열이 전부 FIRED/BLOCKED-OK면 → H1 *지지*(하네스가 실제로 작동). 하나라도 SILENT면
→ 그 기계장치는 *스크립트는 맞지만 런타임에 안 닿는다* = 배선/탐지 갭 = 최우선 수정 대상.

## 끝나면 (정직성 잠금)
- 런타임 열은 *내가 세션에서 직접 본 것만* 채운다. 직접 스크립트를 부른 건 런타임 증거가 아니다.
- 결과를 `review/2026-06-04-shakedown-result.md`의 BLACKBOX에 **런타임 열 추가**로 합치고,
  SILENT 행을 TODO 🔬/devils-advocate로 적재.
- de-dup 리셋(재시도 시): `rm -rf ~/.harness/stage-inject/` 로 stage-inject 1회 마커 초기화.
- 정리: `/plugin uninstall harness@newkayak12-claude-skills` (원하면) · `rm -rf /tmp/harness-live`
