# Harness Feedback — 처리 기록

- **처리일**: 2026-06-23
- **원본**: harness-cycle.md (상세 피드백)
- **대상**: harness 플러그인 v0.3.8

## 처리 결과

| # | 항목 | 분류 | 처리 |
|---|---|---|---|
| 1 | 게이트 질문 하나씩 너무 느림 | 플러그인 개선 | → 이슈 리포트 |
| 2 | Kill 기준 Exploration에서 강제 확정 | 플러그인 개선 | → 이슈 리포트 |
| 3 | 로드맵 구조화 AI에 떠넘김 | AI 행동 교정 | → 즉시 적용 |
| 4 | Phase 전환 하네스가 가이드 안 함 | 플러그인 개선 | → 이슈 리포트 |
| 5 | 하네스 룰 실질적으로 미강제 | 구조적 한계 | → 메타인지 패턴 보완 |
| 6 | 산출물 채팅에만, docs에 안 씀 | AI 행동 교정 | → 즉시 적용 |
| 7 | AI가 현재 단계 인식 못 함 | AI 행동 교정 | → 즉시 적용 |
| 8 | PDCA Verify/Retrospect 공백 | 플러그인 개선 | → 이슈 리포트 |
| 9 | CLAUDE.md 무시 구조적 원인 | 구조적 한계 | → 메타인지 패턴 보완 |

## feedback.jsonl 블록 이벤트

- target: ~/.claude/statusline-command.sh
- 판정: 버그. phase-guard가 하네스 외부 파일 편집 차단하면 안 됨
- 재현: 이번 세션도 동일 현상 (Python heredoc 내 .md 문자열도 차단됨)
- 처리: 플러그인 이슈 리포트 대상

## AI 행동 교정 (즉시 적용)

- 로드맵: raw 목록 받으면 AI가 의존성/순서/리스크 분석 후 초안 제시
- 산출물: 채팅 출력 \!= 산출물. docs/ 파일로 남겨야 완료
- 단계 인식: 매 작업 전 현재 phase 확인

## 플러그인 이슈 리포트 대상 (5건)

1. [UI] 게이트 배치 입력 — 컨텍스트 한 번에 입력 시 게이트 항목 자동 매핑
2. [Exploration] Kill 기준 defer — Exploration은 사이클 중 확정 예정으로 defer 허용
3. [Phase] Phase 전환 가이드 — 완료 시 체크리스트 + 다음 단계 자동 제안
4. [PDCA] Verify 지원 — Phase 완료 선언 시 AI 자가 점검 후 사용자 verify 요청
5. [Bug] phase-guard 외부 파일 차단 — ~/.claude/ 등 하네스 외부는 대상 제외

## 미결

- 위 5건 이슈 리포트: https://github.com/newkayak12/claude-skills (사용자 직접)

