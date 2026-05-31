# Scripts — 위치 이동됨 (SSOT)

> **이 폴더의 실행 스크립트는 플러그인으로 졸업했다.** 코드의 단일 진실 공급원(SSOT) = [`../plugin/harness/scripts/`](../plugin/harness/scripts/).

## 왜 옮겼나 (Cycle #001 F6)

프로토타입 단계에서 스크립트가 *여기(`scripts/`)* 와 *플러그인(`plugin/harness/scripts/`)* 두 곳에 존재했다. 두 복사본은 *drift*한다 (한쪽만 고치면 불일치). GOAL이 설치형 플러그인이므로 **플러그인을 canonical**로 정하고 이 폴더의 복사본을 제거했다.

→ SSOT 결정 기록: [`../devils-advocate.md`](../devils-advocate.md) Resolution log (F6).

## 실행 스크립트 (canonical 위치)

| 스크립트 | 무엇을 막나 / 돕나 | 관련 룰·문서 | Exit codes |
|---|---|---|---|
| `cycle-init.py` | 사이클 시작 boilerplate, WIP=1 확인 | [09 §9.4](../09-pre-cycle.md#94-pre-cycle-산출물), [SD-03](../situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-한도) | 0 ok / 1 err |
| `hypothesis-register.py` | AP-06 Gate fudging — tamper-evident hash chain (= Böckeler *Sensor*) | [08 §8.4](../08-pass-criteria.md#84-가설-사전-등록-pre-registration), [11 AP-06](../11-anti-patterns.md) | 0 ok / 2 tampered |
| `rules-load.py` | 현재 단계의 룰만 출력 (인지 부하 감소) | [06-rules.md](../06-rules.md) Stage tag | 0 ok |
| `kill-check.py` | AP-10 Sunk-cost rescue — 자동 알람 (= Böckeler *Sensor*) | [07 §7.5](../07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준), [C-06](../situational-rules/cognitive.md#c-06-sunk-cost--과거-투입은-결정에-영향-주지-않는다) | 0 ok / 1 soft / 2 hard |

> **참조 표기 규칙**: 개념 문서(12·13·hooks 등)에서 `scripts/cycle-init.py`처럼 부르는 것은 *개념적 이름*이다. 실제 실행본은 위 canonical 위치에 있고, 플러그인 내부에서는 `${CLAUDE_PLUGIN_ROOT}/scripts/...`로 호출된다.

## 설계 원칙 (유지)

1. **stdlib only** — 외부 의존성 0.
2. **한 파일 ≤ 200 lines**.
3. **CLI 단순**.
4. **실패에 명시적** — exit code 0/1/2 = ok/soft/hard.
5. **사이클 종속** — `cycles/<id>/` 구조 가정.

## 도구 *추가* 기준 (유지)

새 스크립트는 다음 모두 yes일 때만 — *반복 boilerplate or 자기-부정 방지인가 / 수동 시 어떤 anti-pattern인가 / ≤200 lines / 생각 자체를 대체하지 않는가*. no가 1개면 수동이 낫다. ([AP-05 Harness ceremony](../11-anti-patterns.md) 경계)
