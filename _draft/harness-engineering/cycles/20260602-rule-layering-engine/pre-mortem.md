# Pre-mortem — rule layering engine

> "6개월 뒤 이 사이클이 *실패*했다고 가정. 왜 실패했는가?"
> 참조: [C-02 Pre-mortem](../../situational-rules/cognitive.md#c-02-pre-mortem-before-big-bet)

## 실패 시나리오 (≥5)

1. **invariant 판정이 임의 해석** — 어느 L0 룰이 Core(override 불가)인지 SSOT가 없어, 엔진이 추측으로 보호/비보호를 정함 → §2 "해석 금지" 위반. AP-26의 변종.
2. **override가 silent 오작동** — L1이 L0를 덮을 때 같은 id가 아니면 매칭을 못 해, 사용자가 "덮었다"고 믿는데 실제론 둘 다 살아있음(또는 엉뚱한 룰 suppress). 충돌 리포트가 거짓 OK.
3. **머지가 vacuous** — #009 F8 재판: 엔진이 "동작"하지만 실제 effective set이 L0만이고 L1이 안 섞임. self-test가 "존재"만 보고 "머지됨"을 안 봐서 통과.
4. **스코프 과대** — L2/L3까지 욱여넣어 한 세션 초과. (→ 사용자 결정으로 L0+L1만 — 완화됨)
5. **포맷 파서 취약** — L1 per-rule 파서가 user-rules-init 산출물의 변형(빈 Pointer, 멀티라인 Why)에 깨짐. 라운드트립 미검증.

## 가장 가능성 높은 1-2개

- 시나리오 1 (invariant 임의 해석) (가능성: 높음 — SSOT 부재가 구조적)
- 시나리오 2 (override silent 오작동) (가능성: 중·높음 — 매칭 규칙이 핵심)

## 사전 완화책

- 시나리오 1 → invariant 근사를 **명시적 규칙**으로 고정: "(필수)" 섹션 마커 = invariant. 추론 아님, *선언된* 마커. 정밀 per-rule 태깅은 backlog로 honest 분리. 보호 거부 시 충돌 리포트에 *근거(어느 마커)* 출력.
- 시나리오 2 → override는 **명시 `Overrides: <id>`** 또는 **동일 id**만 인정(topic 추론 금지). 매칭 실패 시 *경고를 리포트에 남김*(silent 금지). self-test가 override 전/후 effective set 차이를 단언(비-vacuous, 시나리오 3도 같이 방어).
