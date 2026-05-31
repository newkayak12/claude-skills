#!/usr/bin/env python3
"""
hypothesis-immutability.py — PreToolUse hook (Böckeler *Sensor*, Computational).

등록된 가설 파일(hypotheses.jsonl)을 *손으로 수정*하려는 도구 호출을 차단한다.
가설은 오직 hypothesis-register.py 로만 append 되어야 하며 (tamper-evident hash chain),
직접 Edit/Write 는 AP-06 Gate fudging 의 통로다.

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

PROTECTED = "hypotheses.jsonl"


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
        if Path(p).name == PROTECTED:
            sys.stderr.write(
                "BLOCKED: hypotheses.jsonl 직접 편집 금지 (AP-06 Gate fudging 방지).\n"
                "  등록된 가설은 tamper-evident hash chain 으로 보호된다.\n"
                "  가설을 추가하려면:\n"
                "    python3 ${CLAUDE_PLUGIN_ROOT}/scripts/hypothesis-register.py register \\\n"
                "      --cycle <id> --id <Hn> --hypothesis ... --kill-line ... --pass-line ...\n"
                "  기존 가설 변경이 필요하면 *새 ID* 로 재등록 + ADR 작성.\n"
            )
            sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
