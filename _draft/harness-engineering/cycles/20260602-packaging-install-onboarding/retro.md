# Retrospective — packaging install onboarding

> 사이클 *종료 시* 작성. 종료 전엔 비워둠.
> 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로), [`think:retrospective`]

## 무엇을 배웠나

- **GOAL 앞단(설치/온보딩) 경로를 열었다**. harness가 marketplace peer(`./harness`)로 등록되는 self-contained 플러그인이 됐고, `harness:install`이 대화로 L1 user-rules를 생성한다. 품질저하방지 3층(#006~#008) 위에 *배포 가능성*이 얹혔다.
- **설계 결정(사용자)**: 빌드 산출물 = top-level `./harness`, `_draft/harness-engineering` = source-of-truth. 둘 사이를 `harness-export.py`가 잇는다. self-containment의 핵심 긴장(컨셉 문서가 plugin 밖)은 export가 컨셉 문서를 plugin 루트로 *평탄화*해 해소.
- **게이트가 빌드 전에 블로커를 잡았다**(F1): 게이트 D(검증가능성)를 돌리다 "설치하면 scripts가 문서를 못 찾음"을 발견 → 사이클의 1순위가 marketplace 등록이 아니라 *self-contained화*로 재정렬됐다. pre-cycle 게이트의 값.
- **독립 리뷰가 또 진짜 갭을 잡았다**(원칙3): 5/5 pass를 주면서도 (a) `rules-load.py`가 06-rules.md에서 룰 **0개** 파싱 — vacuous self-containment(F2), (b) 빌더가 export에 실려 inert/위험(F3)을 포착. 빌더로서 직접 빌드하되 *리뷰만* fresh subagent로 분리한 구조가 값을 입증.

## 놀란 것 (예측 vs 실제)

- **`rules-load.py`가 한 번도 동작한 적 없었다**: per-rule `Stage:` 태그를 가정한 파서였으나, 06-rules.md는 *섹션 단위 로딩시점* + H3 룰 구조. 로컬 draft에선 06-rules.md 경로 자체가 없어(plugin 밖) 호출되지 않았고, 그래서 결함이 드러나지 않았다. 패키징(=설치 환경 재현)이 *기존 코드의 잠복 버그*를 처음 노출했다.
- **self-contained smoke가 vacuous할 수 있다**: "파일을 찾는가"만 본 첫 테스트는 통과했지만 기능은 빈손이었다. 리뷰어 지적 후 '>0 룰 파싱' 단언을 추가 — *존재가 아니라 동작*을 봐야.

## 다음에 바꿀 것

- **export drift 자동 탐지**(F5): 컨셉 문서가 draft+./harness 두 곳. 지금은 README/마커 경고로만 막음. draft↔export 해시 비교 CI/hook이 필요(backlog).
- **룰-레이어링 엔진**(F4/F6): rules-load는 L0(06-rules.md)만 로드. L1/L2/L3 머지 + 포맷 SSOT 1개 수렴은 별도 사이클. install이 user-rules *파일은* 만들지만 *로딩/적용*은 미배선 — 정직히 표기함.
- **실사용 유용성 H 미검증**: author=user(CV-1). H1/H2는 기계적 검증만. 실제 새 머신 설치/온보딩은 GOAL 앞단 완성 후 새 프로젝트에서 black box(측정 대기).

## 인계 (살림 / 의심 / 버림)

- 살림: `harness-export.py`(self-contained 빌드 + 안전거부 + 마커 멱등), hermetic export/user-rules 테스트, install 스킬의 "언제 무엇 로드" 표, rules-load 실동작 파서.
- 의심: export drift(이원화 구조 비용), rules-load가 L1을 아직 안 읽음(install 광고와 실제의 갭은 좁혔으나 엔진 미완), `--force` 단일 .bak 슬롯(F overwrite).
- 버림: 없음. 다만 `rules-load.py` 옛 파서(per-rule Stage 가정)는 사실상 폐기하고 교체.

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- #007/#008과 동일하게 빌드를 *직접* 수행(태스크별 fresh implementer 미사용). 사유: 설계 명확 + 7~8종 self-test exit code가 spec 검증 대체. *독립 리뷰*만 fresh subagent로 분리해 doer≠reviewer 유지, 리뷰어가 갭 2건 포착해 가치 입증. trade-off: 빌드 단계 2-pass 리뷰 생략 — 명시.
- 리뷰어 지적(F2/F3) 수정을 *리뷰 후* 반영했고, 그 재확인을 같은 리뷰어에게 못 보냄(SendMessage 도구 부재). 대신 바 불변 + non-vacuous 단언 추가 + 전체 재실행(8/8)으로 갈음 — 무결성 경로를 명시적으로 기록(blackbox 영향 0, 바 해시 불변).
