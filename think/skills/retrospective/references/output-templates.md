# Retrospective — Output Templates

## Standard Output Template

At the end of every retrospective, produce:

```markdown
## 회고 요약 — [기간 또는 프로젝트명]

### Keep (잘한 점)
- ...

### Problem (개선할 점)
- ...

### Try (실험할 것)
- [ ] [ACTION] ...  |  Owner: ...  |  Due: ...  |  Metric: ...

### 핵심 인사이트
> 한두 문장으로 이번 회고에서 발견한 가장 중요한 패턴 또는 교훈.

### 다음 회고
- 날짜: ...
- 확인할 항목: [이번 Try 항목들이 완료되었는지]
```

---

## Concrete Example: Sprint Retrospective

**Context:** 2-week sprint, 3-person team, late delivery of API integration feature.

```markdown
## 회고 요약 — Sprint 12 (2026-03-03 ~ 2026-03-14)

### Keep
- 매일 15분 스탠드업으로 블로커가 당일 해결됨
- PR 리뷰 SLA(24h) 준수율 90% 달성

### Problem
- API 스펙이 스프린트 중반에 변경되어 3일 재작업 발생
- 테스트 커버리지 부족으로 QA 단계에서 회귀 버그 4건 발견

### Try
- [ ] [ACTION] API 변경 사항을 스프린트 플래닝에 포함하는 체크리스트 작성
      Owner: 김민준  |  Due: 다음 플래닝 전  |  Metric: 체크리스트 문서 존재 + 플래닝 때 사용
      Maps to: API 스펙 변경 재작업
- [ ] [ACTION] 신규 엔드포인트에 통합 테스트 최소 1개 의무화 (PR 조건)
      Owner: 이서연  |  Due: Sprint 13 시작 전  |  Metric: PR 체크리스트에 항목 추가, 다음 스프린트 회귀 버그 0건
      Maps to: QA 단계 회귀 버그

### 핵심 인사이트
> 외부 의존성(API 스펙) 변경을 프로세스 안으로 끌어들이지 않으면 재작업 비용이 반복된다.

### 다음 회고
- 날짜: 2026-03-28
- 확인할 항목: 체크리스트 사용 여부, Sprint 13 회귀 버그 수
```
