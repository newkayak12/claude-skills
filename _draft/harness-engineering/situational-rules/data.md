# Situational — 데이터 규율

**트리거**: DB 스키마 설계·마이그레이션·백업·보존기간 결정·민감정보 컬럼 추가 시

## D-01: PII classification — 컬럼 단위로 태그

- **Why**: "어떤 컬럼이 개인정보인가"가 *목록*으로 존재하지 않으면 GDPR/K-개인정보보호법 대응 불가능.
- **How**:
  - 새 컬럼 추가 시 `PII: Y/N`, `Sensitivity: low/medium/high`, `Purpose: <왜 수집>` 태그
  - PII 컬럼은 *별도 테이블*로 분리 검토 (조회 분리 = 노출 범위 축소)
  - 보안 룰 [`security.md#s-07`](./security.md)와 연동

## D-02: Retention policy — 보유 기간을 *코드로* 강제

- **Why**: "필요 없을 때 지운다"는 *지키지 못함*. 자동화 안 한 정책은 정책이 아니다.
- **How**:
  - 엔티티별 보유 기간 명시 (예: User = 탈퇴 후 30일, 로그 = 90일, 결제 = 5년)
  - 만료 cron job 또는 TTL 인덱스(NoSQL)로 *자동 삭제 또는 익명화*
  - 삭제 vs 익명화 결정: 분석에 필요하면 익명화, 아니면 hard delete

## D-03: Backup tested — 복구 한 번도 안 해본 백업은 없는 것

- **Why**: 백업이 "있다"와 "복구된다"는 다른 문제. 운영 사고의 흔한 패턴.
- **How**:
  - 백업 빈도·보관·암호화 정책 결정 (RPO/RTO)
  - **분기별 1회 복구 훈련** — 실제 staging에 복구해 행 수·체크섬 확인
  - 복구 절차를 runbook으로

## D-04: Expand / Contract migration — 무중단

- **Why**: 한 번에 스키마를 바꾸면 *배포 중 일관성 깨짐*. 다단계로 나눠야 운영 무중단.
- **How**:
  - **Expand**: 새 컬럼·새 테이블 추가 (NULL 허용 또는 default). 옛 코드는 변경 없음.
  - **Migrate**: 새/옛 *동시 쓰기*. 백필(backfill)로 옛 데이터 채움.
  - **Contract**: 옛 코드 제거 → 옛 컬럼/테이블 drop
  - 각 단계마다 *배포 + 검증*. 한 PR에 합치지 않음.

## D-05: Migration scripts are idempotent

- **Why**: 마이그레이션 실패 시 *부분 적용* 상태에서 재실행하는 일이 흔함. 멱등하지 않으면 시스템이 망가짐.
- **How**:
  - `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`
  - 백필 스크립트는 *재실행 안전* (where 절로 미처리분만 처리)
  - Migration 도구의 transactional 기능 활용 (지원하는 경우)

## D-06: Schema 변경은 backward-compatible 우선

- **Why**: 클라이언트·다른 서비스가 *동시에* 업데이트되지 않음. 호환 안 되는 변경은 *동시 배포*를 강제.
- **How**:
  - 컬럼 *추가*는 안전. 컬럼 *제거*는 contract 단계까지 미룸.
  - 컬럼 *이름 변경*은 → 새 컬럼 추가 + 동시 쓰기 + 옛 컬럼 제거의 3단계.
  - API 응답도 같은 원리. 필드 *추가* OK, *제거*는 deprecation period 후.

## D-07: Foreign key + Index 명시적으로

- **Why**: FK 없이 관계만 코드로 두면 *고아 데이터* 발생. 인덱스 없는 FK는 조인 성능 폭망.
- **How**:
  - 관계가 있으면 FK 제약 *기본값으로* 둠. 성능 이슈 시에만 의식적으로 제거.
  - FK 컬럼에 *인덱스 자동 생성* (DBMS 따라 다름 — 확인 필요)

## D-08: 정규화로 시작 — 비정규화는 *증거*가 있을 때만

- **Why**: 정규화는 *정합성 보장*. 비정규화는 *정합성 위험*과의 거래.
- **How**:
  - 3NF로 시작
  - 측정한 병목이 있을 때만 의도적 비정규화
  - 비정규화 결정은 ADR — *어떤 쿼리·어떤 측정치·어떤 trade-off*

## D-09: Soft delete vs Hard delete 결정

- **Why**: 둘 다 정당. 다만 *명시적 결정* 없이 섞으면 데이터 일관성 깨짐.
- **How**:
  - 엔티티별 결정 (User = soft, ephemeral log = hard)
  - Soft delete 채택 시: *모든 쿼리에서 `WHERE deleted_at IS NULL`* 강제 — 누락하면 *유출* 또는 *유령 데이터*
  - GDPR right-to-be-forgotten은 *hard delete 또는 익명화*

## D-10: Time zone — UTC 저장, 표시만 local

- **Why**: 시간대 섞이면 *조용한 데이터 오염*. 디버그 매우 어려움.
- **How**:
  - DB·로그·메시지 = UTC + ISO 8601
  - UI·리포트만 사용자 시간대로 변환
  - 새 시간 컬럼 추가 시 timezone-aware 타입 (`TIMESTAMPTZ` 등)

## D-11: 데이터 거주(residency) 요구 점검

- **Why**: GDPR(EU), K-개인정보보호법, 중국 사이버보안법 등이 *국가별 저장 위치*를 요구하는 경우 있음.
- **How**:
  - 사용자 지역이 다양해질 가능성이 있으면 *region-aware 데이터 저장* 설계 사전 검토
  - 클라우드 region 선택 시 *법적 요구*를 ADR로 기록

## 관련 skill

- `develop:database-workflow` — DB 작업 전반 entry point
- `develop:database-optimizer` — 인프라·운영 측 DB 튜닝
- `develop:sql-pro` — 쿼리 작성·튜닝
- `develop:transaction-boundary-reviewer` — 트랜잭션·일관성 경계
