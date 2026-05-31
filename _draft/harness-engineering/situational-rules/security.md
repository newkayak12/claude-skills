# Situational — 보안 Baseline

**트리거**: 인증·권한·PII·토큰·암호화·외부 통신·secret을 다룰 때

OWASP Top 10 / CWE Top 25를 한 번에 다 보지 않는다. 1인 개발자가 *기본만* 깔아도 위험 대부분이 차단된다.

## S-01: Secret은 repo에 들어가지 않는다

- **Why**: GitHub 검색 봇이 *분 단위*로 토큰 유출을 스캔. 한 번 공개되면 *영원히* 공개.
- **How**:
  - `.env` 파일은 `.gitignore` + commit 전 git-secrets / detect-secrets / gitleaks 등의 pre-commit hook
  - 이미 들어간 secret은 **revoke 먼저** → 그다음 history 정리. 순서 바꾸면 무용.
  - 운영 secret은 vault / KMS / secrets manager. 코드는 *참조*만.

## S-02: Principle of Least Privilege

- **Why**: 권한은 *최소로 시작 + 필요 시 추가*가 디폴트. 처음부터 넓게 주면 다시 좁히기 어렵다.
- **How**:
  - DB 계정·API 키·클라우드 IAM 역할을 *기능별*로 분리
  - 운영자 본인 계정도 평소엔 read-only. 변경 시 *명시적 권한 상승*
  - "이 권한이 정말 필요한가?"를 새 권한 부여 시마다 묻기

## S-03: Input validation at boundary, trust within

- **Why**: 모든 함수에서 검증하면 *어디서 신뢰가 시작되는지* 모름. 경계에서만 검증, 내부에선 신뢰.
- **How**:
  - 시스템 경계(HTTP handler, message consumer, CLI parser)에서 *타입 + 도메인 규칙* 검증
  - 검증 후에는 *명확한 타입*(`ValidatedUserInput` 같은)으로 변환해 내부 전달
  - 외부 시스템(외부 API 응답, DB 결과)도 *경계*로 간주

## S-04: Encrypt at rest + in transit

- **Why**: 어느 한 쪽만 암호화하면 *체인의 약한 고리*가 노출됨.
- **How**:
  - TLS 1.2+ for all external traffic. 내부 통신도 *원칙적으로* TLS.
  - DB·객체스토리지의 storage encryption 활성 (대부분 클라우드 기본 제공)
  - 민감 컬럼은 *애플리케이션 레벨* 추가 암호화 (envelope encryption, KMS 키)

## S-05: Authentication ≠ Authorization

- **Why**: 둘을 섞으면 *권한 결함*이 생긴다. "로그인했으니 OK"는 권한 체크가 아니다.
- **How**:
  - 인증: 누구인가 — 토큰 검증, 세션 확인
  - 권한: 무엇을 할 수 있나 — *각 요청*에서 `actor가 resource에 action 권한이 있는가` 명시적 점검
  - 권한 모델 선택을 ADR로 기록 (RBAC / ABAC / ReBAC)

## S-06: 토큰 수명·refresh 정책 명시

- **Why**: "토큰이 안 만료된다"는 *나중에 큰 사건*의 원인. 짧게 유지 + refresh로 UX 보완.
- **How**:
  - Access token: short-lived (15분 ~ 1시간)
  - Refresh token: long-lived but **rotation** (사용 시 새것 발급, 옛것 invalidate)
  - 토큰 *수명, 발급 위치, 폐기 방법*을 ADR에 명시
  - 토큰 storage: `HttpOnly + Secure + SameSite` 쿠키 또는 native secure storage

## S-07: PII 식별 + 처리 규칙

- **Why**: 어떤 컬럼이 개인정보인지 *목록화*되지 않으면 규제 대응 불가능.
- **How**:
  - 데이터 모델 작성 시 각 컬럼에 `PII: Y/N` 태그
  - PII는 *암호화·접근통제·로그 마스킹*을 일관 적용
  - 외부 시스템(로그 수집, 분석 도구)에 PII가 새지 않는지 점검

## S-08: 감사 로그 (Audit Log)

- **Why**: "누가·언제·무엇을 바꿨나"가 없으면 사고 후 *원인 추적 불가능*.
- **How**:
  - 민감 액션(권한 변경, 결제, 데이터 삭제) → audit log 별도 저장소
  - 일반 로그와 *분리*. 사용자가 자기 audit log를 조작할 수 없게.
  - 보존기간: 법정 요구 또는 최소 1년

## S-09: 의존성 보안 — Dependabot / Snyk

- **Why**: 우리 코드는 *우리 의존성만큼* 안전. CVE는 매주 발견.
- **How**:
  - 자동 PR (Dependabot, Renovate)
  - 매주 *critical/high CVE*는 24-48시간 내 패치
  - 의존성 추가는 *최후 수단* — 기본 라이브러리로 가능하면 그쪽

## S-10: Threat Model — STRIDE 6항목 점검

- **Why**: *어떤 위협이 가능한가*를 사전에 적지 않으면 사후 추적이 됨.
- **How**: 시스템의 trust boundary(외부 → 내부, 사용자 → 관리자)마다 STRIDE 점검 — Spoofing·Tampering·Repudiation·Information disclosure·Denial of service·Elevation of privilege

## 관련 skill

- `develop:transaction-boundary-reviewer` — 트랜잭션·일관성 경계의 보안 함의
- `develop:incident-response-playbook` — 보안 사고 발생 시 대응 절차
- `cognition:assumption-extractor` — "이건 안전하다"의 가정을 surface
