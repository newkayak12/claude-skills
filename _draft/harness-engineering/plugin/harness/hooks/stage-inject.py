#!/usr/bin/env python3
"""
stage-inject.py — PreToolUse hook. *단계 진입* 시 그 단계의 effective 룰을 컨텍스트에 주입.

왜 (CA-10, review/2026-06-03):
  rule-inject(SessionStart)은 *경계*에서만 쏜다 — 세션이 시작될 때 1회. 그런데 사용자가
  물은 "context 차오름에 따른 품질 저하"는 *긴 플로우 내부*에서 일어난다. 세션 시작에 쏜
  룰은 플로우가 길어지면 스크롤아웃·compaction에 먹힌다. 즉 *진짜 저하가 일어나는 지점에는
  강제점이 없었다*. 이 hook이 그 구멍을 메운다: 코드 작성이 *실제로 시작되는 순간*(Edit/Write
  도구 호출 = code-writing 단계 진입)에 그 단계 룰(R-CD* 코딩 룰 등)을 *바로 그때* 주입한다.
  방어를 경계에서 플로우 *내부*로 확장 (PF-10).

  부수효과(기능 보존): 이게 생기면 rule-inject(SessionStart)가 정적 L0 default(코딩 룰)를
  빼고 invariant+L1만 쏴도 *기능 저해가 없다* — 코딩 룰이 코딩 시작 시점에 도착하기 때문.
  (rule-inject 가 `--dynamic`으로 슬림해진 근거.)

hook contract 조사 (왜 PreToolUse + JSON additionalContext 인가):
  Claude Code hook 출력 규약(공식 docs 확인):
    - SessionStart/UserPromptSubmit 은 *plain stdout*(exit 0)이 컨텍스트로 주입된다.
    - PreToolUse 의 plain stdout 은 *debug log 행*일 뿐 모델에 안 보인다. PreToolUse 가
      컨텍스트를 주입하려면 stdout 에 JSON 으로
        {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                "permissionDecision": "allow",   # 차단 아님
                                "additionalContext": "<룰>"}}
      을 내야 한다. 이 additionalContext 는 *도구 결과 옆*(=도구 호출 시점)에 주입된다.
  → PreToolUse(Edit|Write|MultiEdit|NotebookEdit) = code-writing 단계 진입의 *결정적* 신호이고,
    JSON additionalContext 로 그 순간 모델 컨텍스트에 *실제로 도달*한다. 그래서 이 방식 채택.
    (UserPromptSubmit 키워드 감지는 비결정적 fallback — 코드가 키워드 없이 시작될 수 있어 미채택.)

설계 경계 (rule-inject 와 동일):
  *주입 ≠ 강제*. soft 안내다 (원칙1 "지도"). permissionDecision=allow — 도구를 막지 않는다.
  진짜 불변량 강제는 게이트·차단성 PreToolUse(hypothesis-immutability 등) 몫(원칙2).

De-dup (스팸 금지):
  같은 (세션, 단계)에 대해 *한 번만* 주입한다. 매 Edit 마다 22룰을 다시 쏘면 스팸이다.
  마커 파일을 세션-스코프 state 디렉토리($HARNESS_HOME/stage-inject/<session>/<stage>)에
  남긴다. 마커가 있으면 무주입(=plain allow). fail-open: 마커 IO 실패해도 막지 않는다.

Wiring (hooks.json):
  "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit|NotebookEdit",
    "hooks": [ { "type": "command",
      "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/stage-inject.py" } ] } ]

Protocol:
  stdin  = PreToolUse event JSON (session_id, tool_name, tool_input)
  exit 0 always (도구를 막지 않는다). 컨텍스트 주입은 stdout JSON additionalContext.
  머지 엔진 부재 / effective 0 / 이미 주입됨 → JSON 없이 exit 0 (fail-open, 무주입).
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

# 이 hook 이 담당하는 단계. PreToolUse(Edit/Write 류) = code-writing 진입.
# (후속: architecture/decision 등 다른 단계 신호가 생기면 매핑 확장.)
STAGE = "code-writing"

BOUNDARY = "[harness] 단계 진입 룰 자동 주입 (stage: code-writing · 안내일 뿐 — 진짜 강제는 게이트/차단성 hook):"


def find_script(name: str):
    """rule-inject.py 와 동일한 해석: CLAUDE_PLUGIN_ROOT 우선, 그다음 상대."""
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    candidates = []
    if root:
        candidates.append(Path(root) / "scripts" / name)
    candidates.append(Path(__file__).resolve().parent.parent / "scripts" / name)
    for c in candidates:
        if c.exists():
            return c
    return None


def harness_home() -> Path:
    """rules-merge.py / user-rules-init.py 와 동일 규약."""
    return Path(os.environ.get("HARNESS_HOME", str(Path.home() / ".harness")))


def read_event() -> dict:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def marker_path(session_id: str, stage: str):
    """세션-스코프 마커. session_id 없으면 None(=de-dup 불가, 그래도 1회 주입은 함)."""
    if not session_id:
        return None
    # session_id 는 파일명에 안전하지 않을 수 있어 해시로 정규화
    sid = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:16]
    return harness_home() / "stage-inject" / sid / f"{stage}.injected"


def already_injected(marker) -> bool:
    return marker is not None and marker.exists()


def mark_injected(marker) -> None:
    if marker is None:
        return
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("1", encoding="utf-8")
    except Exception:
        pass  # fail-open — 마커 못 써도 도구를 막지 않는다 (최악: 다음 Edit 에 1회 더 주입)


def emit_plain_allow() -> None:
    """무주입으로 통과 — JSON 없이 exit 0 (plain allow)."""
    sys.exit(0)


def emit_inject(body: str) -> None:
    """additionalContext 로 룰 주입 + permissionDecision=allow (차단 아님)."""
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "additionalContext": f"{BOUNDARY}\n{body}",
        }
    }
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0)


def main():
    event = read_event()
    session_id = event.get("session_id", "") if isinstance(event, dict) else ""

    marker = marker_path(session_id, STAGE)
    if already_injected(marker):
        emit_plain_allow()  # 이 세션 이 단계엔 이미 주입함 — 스팸 금지

    merge = find_script("rules-merge.py")
    if merge is None:
        emit_plain_allow()  # fail-open — 머지 엔진 못 찾으면 도구 막지 않는다

    result = subprocess.run(
        [sys.executable, str(merge), "effective", "--stage", STAGE],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        emit_plain_allow()  # fail-open — 차단성 충돌 등은 conflicts 가 따로 다룸

    body = result.stdout.strip()
    # effective 0 이면 "(0 effective ...)" 헤더만 → 주입할 룰 없음
    if not body or "(0 effective" in body:
        emit_plain_allow()  # 스팸 금지

    mark_injected(marker)  # 주입 *전에* 표시 — 동시 Edit 경쟁 시 중복 최소화
    emit_inject(body)


if __name__ == "__main__":
    main()
