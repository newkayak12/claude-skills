#!/usr/bin/env python3
"""
hypothesis-immutability.py — PreToolUse hook (Böckeler *Sensor*, Computational).

append-only chain 파일(hypotheses.jsonl, bar.jsonl)을 *손으로 수정*하려는 도구 호출을 차단한다.
각 파일은 오직 전용 등록 스크립트로만 append 되어야 하며 (tamper-evident hash chain),
직접 Edit/Write 는 AP-06 Gate fudging / #006 바 낮추기의 통로다.

이 hook 은 *탐지*(verify)를 *차단*으로 승격시킨다 — 사람이 verify 를 안 불러도 작동.

Wiring (settings.json):
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [ { "type": "command",
                     "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/hypothesis-immutability.py" } ] }
    ]
  }

Protocol:
  stdin  = PreToolUse event JSON  (tool_name, tool_input)
  exit 0 = allow
  exit 2 = block (stderr 가 모델에게 전달됨)
"""
import json
import sys
from pathlib import Path

# 보호 대상 append-only 체인 → 정당 등록 스크립트 안내
PROTECTED = {
    "hypotheses.jsonl": "hypothesis-register.py",
    "bar.jsonl": "bar-register.py",
}


def target_paths(tool_input: dict):
    """편집 도구가 건드리는 파일 경로들을 모은다."""
    for key in ("file_path", "notebook_path", "path"):
        v = tool_input.get(key)
        if isinstance(v, str) and v:
            yield v
    # MultiEdit 변종: edits 배열 안에 file_path 가 있을 수 있음
    edits = tool_input.get("edits")
    if isinstance(edits, list):
        for e in edits:
            if isinstance(e, dict) and isinstance(e.get("file_path"), str):
                yield e["file_path"]


def main():
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        # 입력을 못 읽으면 *통과* — hook 이 정당한 작업을 막으면 안 된다 (fail-open)
        sys.exit(0)

    tool_input = event.get("tool_input") or {}
    for p in target_paths(tool_input):
        name = Path(p).name
        if name in PROTECTED:
            register = PROTECTED[name]
            sys.stderr.write(
                f"BLOCKED: {name} 직접 편집 금지 (AP-06 Gate fudging / #006 바 낮추기 방지).\n"
                f"  이 파일은 tamper-evident hash chain 으로 보호된다.\n"
                f"  항목 추가는: python3 ${{CLAUDE_PLUGIN_ROOT}}/scripts/{register} register ...\n"
                f"  기존 항목 변경이 필요하면 *새 ID* 로 재등록 + ADR.\n"
            )
            sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
