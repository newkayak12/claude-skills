# Dogfood Findings — #001

> 이 사이클을 돌리며 *하네스 자신*에서 발견한 고장·갭. 사이클 종료 시 retro carryover의 원료. 이게 첫 사이클의 *진짜 산출물*이다 (`13 §7`이 말한 "실전이 무엇이 필요한지 드러낸다").

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | pre-cycle A | 09-A가 "Y를 만들고 싶다 = solution-shopping"이라 경고 → *하네스를 만드는 행위 자체*를 게이트가 잡음. 문제 진술로 재시작 강제됨 (정상 작동) | low | 게이트가 의도대로 작동. 기록만 |
| F2 | pre-cycle D | 하네스가 **제품-with-users 전제**. dev-tool / 내부 도구 / n=1 self-user 사이클 타입을 안 다룸. Gate 1·"인터뷰 5명"이 어색 | **high** | ✅ **해결** — `09 §9.1b` 사이클 타입 절 추가 (Product/Dev-tool/Exploration). 게이트가 타입별 적응 |
| F3 | pre-cycle C | 시간 예산 단위가 *날짜* 가정인데, AI 세션에선 "세션/appetite"가 더 자연스러움 | medium | cycle-card에서 appetite로 적응함. 07/09에 단위 옵션 명시 필요 |
| F4 | pre-cycle 전반 | 게이트를 수동으로 도는 데 *마크다운 5개 파일*을 열어야 함. tier A 압축본이 없으면 매번 무거움 (`13 §1` 미구현 체감) | medium | → MVE가 정확히 이걸 푼다 (대화형 게이트) |
| F5 | 산출물 | cycle-init.py가 *이 폴더 구조*(blackbox.jsonl, findings.md 등 13에서 새로 생긴 것)를 아직 scaffold 안 함 | medium | → 개발 단계에서 cycle-init.py 업데이트 |

| F6 | 개발 | scripts가 *두 곳*에 존재 — `scripts/`(prototype) + `plugin/harness/scripts/`(copy). SSOT 위반 위험 | **high** | ✅ **해결** — 플러그인 canonical, draft `scripts/*.py` 삭제 + README 포인터화. devils-advocate Resolution log 기록 |
| F7 | 테스트 | SKILL.md가 `hypothesis-register.py`를 `--id H1 --text`로 호출 — *실제 플래그는* `--hypothesis --kill-line --pass-line`. 문서가 코드와 불일치 | medium | ✅ **해결** — SKILL.md 수정. dogfood가 잡은 실제 버그 |
| F8 | 개발 | pivot-triggers를 #001은 *별도 파일*로 만들었으나 cycle-init.py는 cycle-card *인라인*으로 둠 → 산출물 구조 불일치 | low | cycle-init.py의 인라인 방식을 canonical로. #001의 별도 파일은 수동 dogfood 잔재 |
| F9 | 테스트 | `08-pass-criteria`의 Gate가 *제품 전용* 수치(인터뷰 N, P95 등) — dev-tool 사이클엔 self-test/스캐폴드-동작 같은 *다른 DoD*가 필요 | medium | 백로그 — 08에 타입별 Gate 변형 추가 (F2의 09 작업과 짝) |
| F10 | post-cycle (steering loop) | Böckeler "Harness Engineering for Coding Agents" 발견 → 우리 13장 설계가 *독립 수렴*(Computational/Inferential, black box=Sensor). 빌드된 MVE를 Guide/Sensor로 audit: **Guide**=게이트(Inferential)+WIP체크(Computational), **Sensor**=hypothesis hash 등록. *사이클 중 차단하는 Computational Sensor 루프는 아직 없음* | low(긍정) | ✅ `00 §0.2b` 포지셔닝 + `13 §3` 어휘 retag. 차별점=4번째 규제범주(Product/Process Validation). 차단 Sensor 루프는 `13 §7` 백로그 |

## 살아있는 로그
- 개발/테스트 완료. F6·F9는 백로그(MVE 범위 밖), F7·F2는 이번에 해결.
- **MVE 검증 결과**: cycle-init.py가 fresh dir에서 9개 산출물 + active symlink 생성 (exit 0), WIP=1 강제(exit 1), 사이클 타입 표시 — 모두 통과. plugin.json valid JSON.
- **F10 (post-cycle)**: 사이클 종료 *후* Böckeler 프레임워크 grounding. Steering Loop의 입력 — 다음 사이클은 *차단 Sensor 1개 실제 wiring*을 우선순위로 (Guide/Sensor 균형). 닫힌 retro는 보존, 이 학습은 다음 사이클 큐로 이월.
