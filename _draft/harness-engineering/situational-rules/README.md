# Situational Rules

`06-rules.md`의 항상 적용 룰과 달리, 이 폴더의 룰은 **상황이 발생할 때만** 참조한다. 사이클 내내 펼쳐놓을 필요는 없고, 트리거가 발생하면 그 영역만 열어 본다.

## 파일별 트리거

| 파일 | 트리거 — *이때 참조* |
|---|---|
| [`security.md`](./security.md) | 인증·권한·PII·토큰·암호화·외부 통신·secret을 다룰 때 |
| [`data.md`](./data.md) | DB 스키마 설계·마이그레이션·백업·보존기간 결정·민감정보 컬럼 추가 시 |
| [`operations.md`](./operations.md) | 출시 직전 / 운영 중 / Performance budget·Observability 설정·SLO/SLA 합의 시 |
| [`cognitive.md`](./cognitive.md) | 결정 마비 / 한 옵션에 강한 끌림 / 큰 베팅·되돌릴 수 없는 결정 직전 |
| [`self-discipline.md`](./self-discipline.md) | 사이클이 늘어짐 / WIP가 1을 초과 / 출시를 계속 미룸 / 검증 대신 코드를 짜고 있음 |

## 핵심 원칙은 `06-rules.md`로

이 폴더 룰을 적용한 *결과*가 ADR/Design Doc에 영향을 주면, 그 결정은 `06-rules.md`의 `R-DD01`(ADR 작성) 룰에 따라 정식 기록된다. 즉 situational 룰은 *항상 적용 룰과 충돌하지 않고 보완*한다.

## 점진 채택 (Progressive Adoption)

5개 영역을 한 번에 적용하지 않는다. 사이클을 돌면서 *가장 자주 부딪히는 영역*부터 1-2개 채택. 채택 시 다음을 적는다:

- 어느 영역을 채택했나
- 왜 지금인가 (어떤 사건이 트리거였나)
- 다음 사이클에서도 유지할 것인가
