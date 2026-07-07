#!/usr/bin/env python3
"""feedbacklib.py — beta 사용 마찰 이벤트를 .claude/.feedback/feedback.jsonl 에 기록.

harness 를 *실제로 쓰는 동안* 발생하는 마찰(게이트 차단·fail-open·예상밖 동작)을
구조화해 누적한다. beta report 의 원료. 차단성 hook 들이 차단 순간 호출한다.

설계:
  - 위치: `$CLAUDE_PROJECT_DIR/.claude/.feedback/` 우선 (Claude Code 가 hook 에 주입).
    없으면 `cwd/.claude/.feedback/`. 둘 다 안 되면 침묵 포기 — *기록보다 hook 본업이 우선*.
  - fail-soft: `record()` 는 **절대 raise 하지 않는다**. 어떤 IO/직렬화 실패도 삼킨다.
    feedback 기록 실패가 호출 hook 의 차단/통과 판정을 바꾸면 안 된다 (#013b H2 kill-line).
  - append-only jsonl. 한 줄 = 한 이벤트. 사람이 grep/jq 로 읽어 report 작성.

수동 기록도 가능:
  python3 -c "import feedbacklib; feedbacklib.record('manual','friction','설명')"
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def _feedback_dirs():
    """기록 후보 디렉토리 (우선순위 순). CLAUDE_PROJECT_DIR → cwd."""
    base = os.environ.get("CLAUDE_PROJECT_DIR")
    out = []
    if base:
        out.append(Path(base) / ".claude" / ".feedback")
    out.append(Path.cwd() / ".claude" / ".feedback")
    return out


def record(hook, event, detail, **extra):
    """마찰 이벤트 1건 append. 성공 시 True, 실패 시 False — *절대 raise 안 함*(fail-soft)."""
    try:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "hook": hook,
            "event": event,
            "detail": detail,
        }
        if extra:
            entry.update(extra)
        line = json.dumps(entry, ensure_ascii=False)
    except Exception:
        return False
    for d in _feedback_dirs():
        try:
            d.mkdir(parents=True, exist_ok=True)
            with (d / "feedback.jsonl").open("a", encoding="utf-8") as f:
                f.write(line + "\n")
            return True
        except Exception:
            continue
    return False
