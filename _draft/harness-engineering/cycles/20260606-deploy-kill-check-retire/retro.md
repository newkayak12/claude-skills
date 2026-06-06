# Retrospective — deploy-kill-check-retire (#015)

> 첫 *순수 "빼기"* 사이클 — 새 메커니즘 0, 은퇴 2. ADR-0001 standing 부채 해소.

## 무엇을 배웠나

- **ratchet 의 "빼기 강제"가 처음으로 실제 빼기를 유도했다.** #013c 가 27 을 잠그고 #014 가 force 로 28 을
  밀었을 때, ratchet 은 "다음 사이클에 빼라"는 부채를 남겼다. 이번 사이클이 그 빼기를 실행 → count 26,
  floor 27→26. **게이트가 의도한 압력(증식 억제)이 설계대로 작동**한 첫 사례.
- **구현했다고 효과가 보장되지 않는다.** deploy-kill-check 은 #005 에서 self-test 7/7 로 "완성"됐지만 실사용
  발화 0 이었다. *측정 가능한 것만 강제한다*의 따름정리: **발화로 검증되지 않은 Sensor 는 강제가 아니라 비용.**
- **은퇴는 연쇄를 드러낸다.** deploy-kill-check 을 빼니 kill-check 가 고아가 되고, kill-check 를 빼니
  session_count 가 고아가 됐다(K1). 3단 의존의 꼬리를 당기면 줄줄이 딸려 나온다 — 한 번에 어디까지 자를지는
  *다른 책임(metrics 갱신)과의 교차*가 결정한다.

## 놀란 것 (예측 vs 실제)

- F3(accept-new-baseline 부재)이 이번엔 *안 보였다*(K3) — 실제로 메커니즘을 빼서 26 을 정직 달성하니
  force 가 불필요했기 때문. F3 은 "빼기 불가능한데 +1 정당"한 경우에만 드러나는 잠복 갭임을 확인.
- session_count 가 사실상 *아무도 안 읽는 데이터*가 됐는데, 그 소비자(kill-check)를 빼는 것이 동기였다.
  "측정만 하고 안 쓰는 지표는 비용"이라는 #004 의 교훈이 이번엔 session_count 자신에게 부메랑.

## 다음에 바꿀 것

- **session-counter 은퇴 여부를 rank4(metrics SPOF 가변/불변 분리)와 묶어** 검토(K1). 지금 단독 제거는
  metrics 갱신 경로를 건드려 위험.
- 남은 P0 후속: ⓔ close `--force` blackbox 미기록(#014 F2, high), ⓕ ratchetlib accept-new-baseline(F3),
  ⓑ ceremony-free, ⓒ GOAL.md 명시화.

## 인계 (살림 / 의심 / 버림)

- 살림: ratchet 의 "빼기 압력"이 작동한다는 실증, 은퇴 노트 패턴(라이브 문서만 갱신·히스토리 보존),
  count 26 floor.
- 의심: C-06 Sunk-cost 방어가 이제 narrative 뿐 — 실제로 죽은 사이클을 배포로 미는 걸 *코드*가 더는 안 막음.
  단 발화 0 이었으므로 잃은 실효는 0(이론적 방어만 상실). 후일 실사용에서 sunk-cost rescue 가 *실제로*
  발생하면 그때 측정 가능한 형태로 재도입 검토.
- 버림: deploy-kill-check.py·kill-check.py(발화 0·효과 최약·3단 의존), metrics `kill_check` 필드(vestigial).

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- 없음. --force 없이 정상 게이트로 닫힘. ADR-0001 이 예고한 "은퇴로 27 복원"을 26 으로 초과 달성하며
  standing 부채를 닫았다(self-stamp 탈출구 미사용).
