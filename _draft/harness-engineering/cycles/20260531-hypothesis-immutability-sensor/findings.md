# Dogfood Findings — hypothesis-immutability-sensor

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | 개발 | PreToolUse 입력 스키마는 도구별로 키가 다름 — Edit/Write=`file_path`, NotebookEdit=`notebook_path`, MultiEdit은 `edits[]` 안에도 있을 수 있음. 단일 키 가정하면 변종이 새어나감 | medium | ✅ 해결 — `target_paths()`가 file_path/notebook_path/path + edits[] 모두 스캔 |
| F2 | 테스트 | 세션 *밖* 편집(에디터로 직접 hypotheses.jsonl 수정)은 PreToolUse로 *못 막음* — hook은 도구 호출만 가로챔 | **high** | 백로그 — SessionStart verify 경고를 짝 Sensor로 추가 (탐지 보강). pivot-trigger 3과 일치 |
| F3 | 설계 | hook을 fail-open(파싱 실패 시 통과)으로 함 — 안전하나 *조작된 입력으로 우회* 가능성. dev-tool n=1엔 과한 우려, 기록만 | low | 기록만. 멀티유저 맥락이면 fail-closed 재검토 |
| F4 | 빌드 | 플러그인에 `hooks/` 디렉터리 신설 — `hooks.json` + 스크립트 + README. 컨셉 카탈로그(`../../../hooks/README.md`, 16개 spec)와 *실구현*(plugin/harness/hooks/, 1개)이 분리됨 | low | 정상 — spec은 draft, 구현은 플러그인. SSOT 명확 |

## 살아있는 로그
- **개발/테스트 완료.** hook 빌드 → self-test 5/5 통과 → 플러그인 wiring(hooks.json).
- **H1·H2 지지**: Edit/Write/MultiEdit의 hypotheses.jsonl 차단(exit2), 비대상·register 경로 통과(false positive 0), fail-open 확인. chain 최종 verify intact.
- **F2가 가장 큰 잔여**: PreToolUse는 *도구 호출*만 가로채므로 세션 밖 편집은 못 막음. 다음 Sensor(SessionStart verify)로 보강 예약.
- **첫 Computational Sensor 실증**: Böckeler Guide/Sensor 균형에서 Sensor 쪽 첫 wiring. `CV-1` 물리적 방어의 실제 첫 조각.
