# Independent Review Gate (#007) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사이클을 닫으려면 잠긴 품질 바(`bar.jsonl`)의 *모든* 기준에 대해 그 기준의 잠긴 해시를 참조하는 `verdict=pass` 독립 리뷰(`review.jsonl`)가 존재해야 하고, 없으면 `close-cycle.py`가 종료를 거부하며 수동 우회(`rm cycles/active`)는 hook이 차단한다.

**Architecture:** 기존 #006 패턴을 *대칭 확장*한다. ① `review.jsonl`은 `hypotheses.jsonl`·`bar.jsonl`과 같은 `chainlog` 해시 체인 — 전용 `review-register.py`로만 append. ② 종료는 `close-cycle.py`가 유일 정당 경로(게이트 내장, in-process unlink). ③ `cycles/active` 수동 제거는 새 `active-symlink-guard.py` PreToolUse(Bash) hook이 차단 — `bar.jsonl` 보호 hook과 대칭. `doer≠reviewer`(fresh subagent 채점)는 *프로토콜*이고, 게이트가 강제하는 건 그 산출물(리뷰 레코드)의 *존재 + 잠긴 바 결박 + pass*다.

**Tech Stack:** Python 3 stdlib (argparse, json, hashlib via `chainlog`, subprocess, re, pathlib). 테스트는 bash self-test 스크립트(pytest 없음) — exit code/출력 검사. 대상 디렉토리: `_draft/harness-engineering/plugin/harness`.

**정직한 한계 (구현·문서에 반영할 것):**
- **fresh subagent는 증명이 아니라 프로토콜.** 코드는 리뷰가 *진짜 독립 컨텍스트*에서 왔는지 증명 못 한다. 게이트는 "잠긴 바를 참조하는 pass 레코드가 없으면 close 불가"까지만 강제. 단, 판단이 불변 기록으로 남아 self-grading이 black box/retro 대면(AP-31)에 노출됨.
- **바 낮추기는 *불가능*이 아니라 *가시화*.** `bar-register`가 같은 cycle 내 중복 `--id`를 거부 → 한 기준을 약하게 재정의하는 silent 경로 차단. 새 id로 *추가*는 가능(바를 높이는 방향). 진짜 낮추려면 체인+ADR에 흔적.
- **guard hook은 Bash의 `rm`/`unlink`만.** `mv`·python `os.unlink`·`find -delete`·`rm -rf cycles/active/`(후행 슬래시)는 못 잡는다 — `deploy-kill-check`의 키워드 매칭과 동급 한계. `close-cycle.py`는 *in-process*로 unlink 하므로 이 hook 대상 아님(정당 경로).

---

## Codebase Survey (구현자가 따를 패턴)

읽어둘 기존 파일 — **그대로 모방**할 것:

- `plugin/harness/scripts/chainlog.py` — 공유 체인. `append_entry(path, entry)->entry`(prev_hash·hash 채워 append), `verify_chain(path)->(ok:bool, count:int, err:str|None)`, `last_hash`, `compute_hash`. **신규 register는 이걸 import만 한다 — 체인 로직 재구현 금지(DRY).**
- `plugin/harness/scripts/bar-register.py` — register/verify/list 구조의 *정본*. `sys.path.insert(0, ...parent); import chainlog`. `CYCLES_DIR = Path("cycles")`. cycle 디렉토리 존재 확인 후 append. **`review-register.py`는 이 구조를 1:1로 따른다.**
- `plugin/harness/scripts/hypothesis-register.py` — 같은 패턴(참고).
- `plugin/harness/hooks/hypothesis-immutability.py` — PreToolUse 차단 hook. `PROTECTED` dict, `target_paths`, fail-open(`json` 파싱 실패→exit 0). **여기에 `review.jsonl` 보호를 추가**하고, `active-symlink-guard.py`는 이 fail-open 규약을 따른다.
- `plugin/harness/hooks/deploy-kill-check.py` — Bash/프롬프트 텍스트를 보는 hook + `CLAUDE_PLUGIN_ROOT` + 상대경로 fallback으로 스크립트 찾기. **`active-symlink-guard`·`close-cycle`의 스크립트 탐색·exit 매핑 참고.**
- `plugin/harness/hooks/active-cycle-verify.py` — SessionStart 검증 hook(현재 hypotheses만). **F5에서 bar·review 체인도 검증하도록 확장.**
- `plugin/harness/scripts/test-bar-register.sh` — self-test 관례: `cd "$(dirname "$0")/../../.."`(harness-engineering 루트), tmp 사이클 생성→실행→`rm -rf`→`PASS` 출력. **모든 신규 self-test가 이 관례를 따른다.**
- `plugin/harness/hooks/hooks.json` — hook wiring. PreToolUse에 `matcher` 블록 추가.
- `plugin/harness/scripts/cycle-init.py` — 스캐폴딩. `bar.jsonl` touch + 안내 출력 패턴.

`@superpowers:test-driven-development` 을 각 태스크에 적용: 실패 테스트 작성 → 실패 확인 → 최소 구현 → 통과 확인 → 커밋.

---

## File Structure

**신규 (NEW):**

| 파일 | 책임 |
|---|---|
| `plugin/harness/scripts/review-register.py` | 독립 리뷰 verdict를 `review.jsonl`에 append. `--criterion-id`로 `bar.jsonl`에서 잠긴 `bar_hash` 자동 해소. register/verify/list. |
| `plugin/harness/scripts/close-cycle.py` | 유일 정당 종료 경로. 게이트(3체인 verify + 모든 바 기준에 pass 리뷰) 통과 시에만 blackbox 제시→metrics `status=closed`→active in-process unlink. `--force`(ADR) 탈출구. |
| `plugin/harness/hooks/active-symlink-guard.py` | PreToolUse(Bash) — `rm`/`unlink cycles/active`(심링크 자체) 차단. fail-open. |
| `plugin/harness/scripts/test-review-register.sh` | review-register self-test. |
| `plugin/harness/scripts/test-close-cycle.sh` | close-cycle 게이트 self-test (차단/통과/바없음). |
| `plugin/harness/hooks/test-active-symlink-guard.sh` | guard hook self-test (차단/통과/fail-open). |

**수정 (MODIFIED):**

| 파일 | 변경 |
|---|---|
| `plugin/harness/scripts/bar-register.py` | 같은 cycle 내 중복 `--id` 거부. |
| `plugin/harness/scripts/test-bar-register.sh` | 중복 id 거부 케이스 추가. |
| `plugin/harness/hooks/hypothesis-immutability.py` | `PROTECTED`에 `review.jsonl`→`review-register.py` 추가. |
| `plugin/harness/hooks/active-cycle-verify.py` | bar·review 체인도 verify (F5). |
| `plugin/harness/hooks/hooks.json` | PreToolUse에 `matcher:"Bash"` 블록(guard) 추가. |
| `plugin/harness/scripts/cycle-init.py` | `review.jsonl` touch + 안내 출력 + cycle-card 문서 줄. |
| `plugin/harness/hooks/README.md` | guard hook + active-cycle-verify 확장 문서화, self-test 케이스. |
| `13-operational-layer.md` | Computational 강제 표에 Close 게이트 행 추가. |

---

## Chunk 1: review-register + review.jsonl 보호

리뷰 체인과 그 등록 스크립트, 그리고 직접 편집 차단을 함께 만든다(무결성 단위).

### Task 1.1 — review-register self-test 작성 (실패)

- [ ] `plugin/harness/scripts/test-review-register.sh` 생성:

```bash
#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../../.." || exit 1   # harness-engineering 루트로
CID=_tmp-reviewreg
rm -rf "cycles/$CID"; mkdir -p "cycles/$CID"; : > "cycles/$CID/bar.jsonl"
BR="python3 plugin/harness/scripts/bar-register.py"
RR="python3 plugin/harness/scripts/review-register.py"
fail=0

# 바 2개 등록 (리뷰 대상)
$BR register --cycle $CID --id B1 --criterion "c1" --stage test  --measure "m1" >/dev/null
$BR register --cycle $CID --id B2 --criterion "c2" --stage close --measure "m2" >/dev/null

# 1) 정상 등록(bar-hash 자동 해소) + verify + list
$RR register --cycle $CID --id R1 --criterion-id B1 --verdict pass \
   --evidence "self-test" --reviewer "subagent:test" >/dev/null \
  && $RR verify --cycle $CID >/dev/null \
  && $RR list --cycle $CID >/dev/null \
  || { echo "FAIL: 정상 등록/verify/list"; fail=1; }

# 2) 존재하지 않는 criterion-id 거부 (exit != 0)
if $RR register --cycle $CID --id RX --criterion-id BX --verdict pass \
     --evidence x --reviewer y >/dev/null 2>&1; then
  echo "FAIL: 없는 criterion-id 가 통과됨"; fail=1
fi

# 3) bar_hash 결박 — review.bar_hash == bar[B1].hash
BH=$(python3 -c "import json;print([json.loads(l)['hash'] for l in open('cycles/$CID/bar.jsonl') if l.strip() and json.loads(l)['id']=='B1'][0])")
RH=$(python3 -c "import json;print([json.loads(l)['bar_hash'] for l in open('cycles/$CID/review.jsonl') if l.strip() and json.loads(l)['criterion_id']=='B1'][0])")
[ "$BH" = "$RH" ] || { echo "FAIL: bar_hash 결박 불일치"; fail=1; }

rm -rf "cycles/$CID"
[ $fail -eq 0 ] && echo "review-register self-test: PASS"
exit $fail
```

- [ ] `chmod +x plugin/harness/scripts/test-review-register.sh`

### Task 1.2 — 실패 확인

- [ ] `bash plugin/harness/scripts/test-review-register.sh` 실행 → `review-register.py`가 없어 실패(비-0). 출력에 python 에러 또는 FAIL 라인.

### Task 1.3 — review-register.py 구현

- [ ] `plugin/harness/scripts/review-register.py` 생성:

```python
#!/usr/bin/env python3
"""
review-register.py — Independent-review verdicts with a tamper-evident hash chain (#007 ②).

doer≠reviewer: fresh subagent 가 잠긴 품질 바(bar.jsonl)의 각 기준을 채점하고
그 결과를 review.jsonl 에 append 한다. close-cycle.py 게이트가 이 레코드를 소비한다.

bar_hash 는 사람이 손으로 적지 않는다 — criterion-id 로 bar.jsonl 에서 *현재 잠긴 해시*를
자동 해소해 결박한다. 바를 사후에 낮추면(새 엔트리) hash 가 달라져 게이트가 여전히 차단.

Usage:
  review-register.py register --cycle <id> --id <Rn> --criterion-id <Bn> \\
      --verdict pass|fail --evidence "..." --reviewer "<who>"
  review-register.py verify --cycle <id>
  review-register.py list   --cycle <id>
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chainlog  # noqa: E402

CYCLES_DIR = Path("cycles")
VERDICTS = ("pass", "fail")


def review_file(cycle_id: str) -> Path:
    return CYCLES_DIR / cycle_id / "review.jsonl"


def bar_file(cycle_id: str) -> Path:
    return CYCLES_DIR / cycle_id / "bar.jsonl"


def resolve_bar_hash(cycle_id: str, criterion_id: str) -> str:
    """criterion-id 로 잠긴 바 엔트리의 hash 를 해소. 없거나 중복이면 종료(exit 1)."""
    path = bar_file(cycle_id)
    if not path.exists():
        print(f"ERROR: bar.jsonl not found at {path} — 먼저 품질 바를 등록하세요.", file=sys.stderr)
        sys.exit(1)
    matches = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        if e.get("id") == criterion_id:
            matches.append(e)
    if not matches:
        print(f"ERROR: 품질 바에 criterion id '{criterion_id}' 없음. bar-register.py list 로 확인.",
              file=sys.stderr)
        sys.exit(1)
    if len(matches) > 1:
        print(f"ERROR: 품질 바에 criterion id '{criterion_id}' 중복 — 바 무결성 위반.", file=sys.stderr)
        sys.exit(1)
    return matches[0]["hash"]


def cmd_register(args):
    cdir = CYCLES_DIR / args.cycle
    if not cdir.exists():
        print(f"ERROR: cycle directory not found: {cdir}", file=sys.stderr)
        sys.exit(1)
    bar_hash = resolve_bar_hash(args.cycle, args.criterion_id)
    entry = chainlog.append_entry(review_file(args.cycle), {
        "id": args.id,
        "criterion_id": args.criterion_id,
        "bar_hash": bar_hash,
        "verdict": args.verdict,
        "evidence": args.evidence,
        "reviewer": args.reviewer,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    })
    print(f"REGISTERED review [{args.id}] {args.criterion_id} -> {args.verdict} (cycle {args.cycle})")
    print(f"  bar_hash: {bar_hash[:16]}...  (잠긴 바에 결박)")
    print(f"  evidence: {args.evidence}")
    print(f"  reviewer: {args.reviewer}")
    print(f"  hash: {entry['hash'][:16]}...")
    print()
    print("주의: 이 레코드를 *수정*하면 verify 에서 탐지됨. 재채점은 *새 ID*로.")


def cmd_verify(args):
    ok, count, err = chainlog.verify_chain(review_file(args.cycle))
    if ok:
        print(f"OK — {count} reviews verified, chain intact")
        sys.exit(0)
    print(f"FAIL: {err}", file=sys.stderr)
    sys.exit(2)


def cmd_list(args):
    path = review_file(args.cycle)
    if not path.exists() or path.stat().st_size == 0:
        print("(no reviews registered yet)")
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        print(f"[{e['id']}] {e['criterion_id']} -> {e['verdict']}  (bar {e['bar_hash'][:12]}…)")
        print(f"  evidence: {e['evidence']}")
        print(f"  reviewer: {e['reviewer']}")
        print()


def main():
    parser = argparse.ArgumentParser(
        description="Independent-review registration with hash chain (#007)"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("register", help="Register a review verdict")
    p.add_argument("--cycle", required=True)
    p.add_argument("--id", required=True, help="Short review ID, e.g., R1")
    p.add_argument("--criterion-id", required=True, help="Bar criterion being graded, e.g., B1")
    p.add_argument("--verdict", required=True, choices=VERDICTS)
    p.add_argument("--evidence", required=True, help="관측 근거 (bar 의 measure 에 대고)")
    p.add_argument("--reviewer", required=True, help="채점자 식별 (예: subagent:spec-reviewer)")
    p.set_defaults(func=cmd_register)

    pv = sub.add_parser("verify", help="Verify review chain integrity")
    pv.add_argument("--cycle", required=True)
    pv.set_defaults(func=cmd_verify)

    pl = sub.add_parser("list", help="List registered reviews")
    pl.add_argument("--cycle", required=True)
    pl.set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
```

### Task 1.4 — 통과 확인

- [ ] `bash plugin/harness/scripts/test-review-register.sh` → `review-register self-test: PASS`, exit 0.

### Task 1.5 — review.jsonl 직접편집 차단 추가

- [ ] `plugin/harness/hooks/hypothesis-immutability.py`의 `PROTECTED`에 한 줄 추가:

```python
PROTECTED = {
    "hypotheses.jsonl": "hypothesis-register.py",
    "bar.jsonl": "bar-register.py",
    "review.jsonl": "review-register.py",
}
```

- [ ] 차단 동작 확인 (수동):

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/review.jsonl"}}' \
  | python3 plugin/harness/hooks/hypothesis-immutability.py; echo "exit=$?"
# 기대: BLOCKED ... review-register.py 안내, exit=2
```

### Task 1.6 — 커밋

- [ ] `git add plugin/harness/scripts/review-register.py plugin/harness/scripts/test-review-register.sh plugin/harness/hooks/hypothesis-immutability.py`
- [ ] 커밋 메시지: `feat(harness): review-register + review.jsonl chain & protection (#007 ch1)` + 트레일러 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Chunk 2: bar-register 중복 id 거부

게이트가 의미를 가지려면 한 기준 id가 유일해야 한다(바 낮추기 silent 차단).

### Task 2.1 — test-bar-register.sh에 실패 케이스 추가

- [ ] `plugin/harness/scripts/test-bar-register.sh`를 아래로 교체(기존 + 중복 거부 케이스):

```bash
#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../../.." || exit 1   # harness-engineering 루트로
CID=_tmp-barreg
rm -rf "cycles/$CID"; mkdir -p "cycles/$CID"; : > "cycles/$CID/bar.jsonl"
R="python3 plugin/harness/scripts/bar-register.py"
fail=0

$R register --cycle $CID --id B1 --criterion "gate2 정량 충족" --stage test --measure "self-test N/N" >/dev/null \
  && $R register --cycle $CID --id B2 --criterion "리뷰 지적 0" --stage close --measure "blackbox 0건" >/dev/null \
  && $R verify --cycle $CID >/dev/null \
  && $R list --cycle $CID >/dev/null \
  || { echo "FAIL: 기본 등록/verify/list"; fail=1; }

# 중복 id 거부 (exit != 0) — 바 낮추기 silent 경로 차단
if $R register --cycle $CID --id B1 --criterion "약하게 재정의" --stage test --measure "낮춘 바" >/dev/null 2>&1; then
  echo "FAIL: 중복 id B1 가 통과됨 (바 낮추기 차단 실패)"; fail=1
fi

rm -rf "cycles/$CID"
[ $fail -eq 0 ] && echo "bar-register self-test: PASS"
exit $fail
```

### Task 2.2 — 실패 확인

- [ ] `bash plugin/harness/scripts/test-bar-register.sh` → 중복 id가 현재는 통과되므로 `FAIL: 중복 id ...`, exit 1.

### Task 2.3 — bar-register.py에 중복 거부 구현

- [ ] `plugin/harness/scripts/bar-register.py`의 `cmd_register` 안, `chainlog.append_entry(...)` 호출 *직전*에 삽입:

```python
    # 중복 id 거부 — 같은 cycle 에서 한 기준을 두 번 등록(바 낮추기 통로) 차단.
    # 기준 변경은 *새 ID*로만 (silent lowering 방지, #007). 추가는 바를 높이는 방향.
    existing = bar_file(args.cycle)
    if existing.exists():
        for line in existing.read_text(encoding="utf-8").splitlines():
            if line.strip() and json.loads(line).get("id") == args.id:
                print(
                    f"ERROR: bar id '{args.id}' 이미 등록됨 (cycle {args.cycle}). "
                    f"기준 변경은 *새 ID*로 — 같은 id 재등록은 바 낮추기 통로라 거부됩니다.",
                    file=sys.stderr,
                )
                sys.exit(1)
```

> 참고: `bar-register.py`는 이미 `import json`과 `bar_file()`을 top-level에 가지고 있다(추가 import 불필요).

### Task 2.4 — 통과 확인

- [ ] `bash plugin/harness/scripts/test-bar-register.sh` → `bar-register self-test: PASS`, exit 0.

### Task 2.5 — 커밋

- [ ] `git add plugin/harness/scripts/bar-register.py plugin/harness/scripts/test-bar-register.sh`
- [ ] 커밋: `feat(harness): bar-register rejects duplicate id (#007 ch2)` + 트레일러.

---

## Chunk 3: close-cycle 게이트

유일 종료 경로. 리뷰 없으면 닫지 않는다.

### Task 3.1 — close-cycle self-test 작성 (실패)

- [ ] `plugin/harness/scripts/test-close-cycle.sh` 생성:

```bash
#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../../.." || exit 1   # harness-engineering 루트로
CID=_tmp-close
ROOT="cycles/$CID"
BR="python3 plugin/harness/scripts/bar-register.py"
RR="python3 plugin/harness/scripts/review-register.py"
CC="python3 plugin/harness/scripts/close-cycle.py"

# 실제 active 사이클이 있으면 clobber 위험 — 생략
if [ -L cycles/active ] && [ "$(readlink cycles/active)" != "$CID" ]; then
  echo "SKIP: 실제 active 사이클 존재 — close self-test 생략"; exit 0
fi

setup() {
  rm -rf "$ROOT"; mkdir -p "$ROOT"
  : > "$ROOT/bar.jsonl"; : > "$ROOT/review.jsonl"; : > "$ROOT/blackbox.jsonl"
  printf '{"cycle_id":"%s","status":"active"}\n' "$CID" > "$ROOT/metrics.json"
  ln -sfn "$CID" cycles/active
}
fail=0

# A: 바 있고 리뷰 없음 → 차단(exit 2), symlink 보존
setup
$BR register --cycle $CID --id B1 --criterion c1 --stage test --measure m1 >/dev/null
if $CC >/dev/null 2>&1; then echo "FAIL A: 리뷰 없는데 close 됨"; fail=1; fi
[ -L cycles/active ] || { echo "FAIL A: symlink 사라짐"; fail=1; }

# B: pass 리뷰 등록 → 통과(exit 0), symlink 해제, metrics closed
$RR register --cycle $CID --id R1 --criterion-id B1 --verdict pass --evidence ok --reviewer t >/dev/null
$CC >/dev/null 2>&1 || { echo "FAIL B: 충족했는데 close 안 됨"; fail=1; }
[ -L cycles/active ] && { echo "FAIL B: symlink 남아있음"; fail=1; }
grep -q '"status": "closed"' "$ROOT/metrics.json" || { echo "FAIL B: metrics status!=closed"; fail=1; }

# C: 바 없음 → 차단(exit 2)
setup
if $CC >/dev/null 2>&1; then echo "FAIL C: 바 없는데 close 됨"; fail=1; fi

rm -rf "$ROOT"; rm -f cycles/active
[ $fail -eq 0 ] && echo "close-cycle self-test: PASS"
exit $fail
```

- [ ] `chmod +x plugin/harness/scripts/test-close-cycle.sh`

### Task 3.2 — 실패 확인

- [ ] `bash plugin/harness/scripts/test-close-cycle.sh` → `close-cycle.py` 없어 실패(비-0).

### Task 3.3 — close-cycle.py 구현

- [ ] `plugin/harness/scripts/close-cycle.py` 생성:

```python
#!/usr/bin/env python3
"""
close-cycle.py — The ONLY sanctioned cycle-termination path (#007 quality-floor ②).

사이클을 닫으려면 잠긴 품질 바(bar.jsonl)의 *모든* 기준에 대해, 그 기준의 잠긴
해시를 참조하는 verdict=pass 리뷰(review.jsonl)가 존재해야 한다. 없으면 종료를 거부한다.
이것이 "지친 에이전트가 바를 충족하지 않고 사이클을 닫는" 품질 저하 경로의 물리적 차단선.

fresh subagent 채점(doer≠reviewer)은 *프로토콜*이며, 이 게이트는 그 산출물(리뷰 레코드)의
*존재 + 잠긴 바 결박 + pass*를 강제한다. 종료는 in-process(파이썬)로 active symlink 를
unlink 하므로, Bash 를 가로채는 active-symlink-guard hook 의 대상이 아니다 (정당 경로).

Usage:
  close-cycle.py            # cycles/active 를 닫는다 (게이트 통과 시)
  close-cycle.py --force    # 게이트 무시 강제 종료 (ADR 필수 — 위험)

Exit:
  0 = 닫힘
  2 = 게이트 차단 (리뷰 미충족 / 체인 깨짐 / 바 없음) — symlink 보존
  1 = 사용 오류 (active 없음 등)
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chainlog  # noqa: E402

CYCLES = Path("cycles")
ACTIVE = CYCLES / "active"


def resolve_active() -> str:
    if not ACTIVE.exists() and not ACTIVE.is_symlink():
        print("ERROR: active 사이클이 없습니다 (cycles/active 없음).", file=sys.stderr)
        sys.exit(1)
    name = os.readlink(ACTIVE) if ACTIVE.is_symlink() else ACTIVE.name
    return Path(name).name


def load_entries(path: Path):
    out = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                out.append(json.loads(line))
    return out


def verify_or_block(path: Path, label: str):
    ok, _count, err = chainlog.verify_chain(path)
    if not ok:
        print(f"🛑 CLOSE 차단 — {label} 체인 검증 실패: {err}", file=sys.stderr)
        sys.exit(2)


def main():
    parser = argparse.ArgumentParser(description="Close the active harness cycle (gated).")
    parser.add_argument("--force", action="store_true", help="게이트 무시 강제 종료 (ADR 필수)")
    args = parser.parse_args()

    cid = resolve_active()
    cdir = CYCLES / cid
    bar_path = cdir / "bar.jsonl"
    review_path = cdir / "review.jsonl"
    hyp_path = cdir / "hypotheses.jsonl"
    blackbox_path = cdir / "blackbox.jsonl"
    metrics_path = cdir / "metrics.json"

    if args.force:
        print(f"[WARN] --force: 게이트 무시하고 '{cid}' 강제 종료. ADR 작성 필수.", file=sys.stderr)
    else:
        # 1) 체인 무결성 (있는 것만)
        if hyp_path.exists() and hyp_path.stat().st_size > 0:
            verify_or_block(hyp_path, "hypotheses")

        bar_entries = load_entries(bar_path)
        if not bar_entries:
            print(
                f"🛑 CLOSE 차단 — '{cid}' 에 품질 바(bar.jsonl)가 없습니다.\n"
                "  닫으려면 먼저 bar-register.py 로 기준을 잠그고 독립 리뷰로 충족하세요.\n"
                "  (탐색 사이클이라 바가 불필요하면 --force + ADR)",
                file=sys.stderr,
            )
            sys.exit(2)
        verify_or_block(bar_path, "bar")

        if review_path.exists() and review_path.stat().st_size > 0:
            verify_or_block(review_path, "review")

        # 2) 게이트: 모든 바 기준에 pass 리뷰(잠긴 hash 결박) 존재?
        reviews = load_entries(review_path)
        passing = {}  # criterion_id -> set(bar_hash) with verdict==pass
        for r in reviews:
            if r.get("verdict") == "pass":
                passing.setdefault(r.get("criterion_id"), set()).add(r.get("bar_hash"))

        missing = [b.get("id") for b in bar_entries
                   if b.get("hash") not in passing.get(b.get("id"), set())]
        if missing:
            print(
                "🛑 CLOSE 차단 — 다음 품질 기준이 *잠긴 바에 결박된 pass 리뷰*를 갖지 못함:\n"
                + "".join(f"  - {m}\n" for m in missing)
                + "  독립 리뷰어(fresh subagent)가 review-register.py 로 각 기준을 채점해야 합니다.\n"
                "  (doer≠reviewer — 자기 채점 회피). 바를 낮추면 bar-hash 불일치로 여전히 차단됨.",
                file=sys.stderr,
            )
            sys.exit(2)

    # 3) 통과(또는 force) — black box 의식 제시
    print(f"=== Closing cycle: {cid} ===")
    print()
    print("── Black box 대면 (어긴 것 기록) ──")
    bb = load_entries(blackbox_path)
    if bb:
        for e in bb:
            print(f"  • {json.dumps(e, ensure_ascii=False)}")
    else:
        print("  (blackbox 비어 있음 — override/skip 0건)")
    print()

    # 4) metrics status=closed
    if metrics_path.exists():
        try:
            metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
        except Exception:
            metrics = {}
        metrics["status"] = "closed"
        metrics["closed_at"] = datetime.now(timezone.utc).isoformat()
        metrics_path.write_text(
            json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    # 5) active symlink 해제 (in-process — Bash guard 대상 아님 = 정당 경로)
    if ACTIVE.is_symlink() or ACTIVE.exists():
        ACTIVE.unlink()

    print(f"✓ 사이클 '{cid}' 종료됨. cycles/active 해제.")
    print("다음: retro.md 작성 (살림/의심/버림), TODO.md 큐 갱신 (SD-07).")
    sys.exit(0)


if __name__ == "__main__":
    main()
```

### Task 3.4 — 통과 확인

- [ ] `bash plugin/harness/scripts/test-close-cycle.sh` → `close-cycle self-test: PASS`, exit 0.
- [ ] 회귀 확인: `bash plugin/harness/scripts/test-review-register.sh && bash plugin/harness/scripts/test-bar-register.sh` 둘 다 PASS.

### Task 3.5 — 커밋

- [ ] `git add plugin/harness/scripts/close-cycle.py plugin/harness/scripts/test-close-cycle.sh`
- [ ] 커밋: `feat(harness): close-cycle gate — block close without passing review (#007 ch3)` + 트레일러.

---

## Chunk 4: active-symlink-guard hook

수동 `rm cycles/active`로 게이트를 우회하는 길을 차단(Full Computational).

### Task 4.1 — guard self-test 작성 (실패)

- [ ] `plugin/harness/hooks/test-active-symlink-guard.sh` 생성:

```bash
#!/usr/bin/env bash
set -u
cd "$(dirname "$0")" || exit 1   # hooks 디렉토리
G="python3 active-symlink-guard.py"
fail=0

expect() { # $1=기대exit  $2=stdin
  echo "$2" | $G >/dev/null 2>&1; rc=$?
  [ "$rc" -eq "$1" ] || { echo "FAIL: exit=$rc(기대 $1) — $2"; fail=1; }
}

# 차단(2): symlink 자체 제거
expect 2 '{"tool_name":"Bash","tool_input":{"command":"rm cycles/active"}}'
expect 2 '{"tool_name":"Bash","tool_input":{"command":"unlink cycles/active"}}'
expect 2 '{"tool_name":"Bash","tool_input":{"command":"rm -f cycles/active && echo done"}}'
# 통과(0): 무관 / 하위 경로 / 정당 경로 / 다른 도구
expect 0 '{"tool_name":"Bash","tool_input":{"command":"rm cycles/active/tmp.txt"}}'
expect 0 '{"tool_name":"Bash","tool_input":{"command":"ls cycles/active"}}'
expect 0 '{"tool_name":"Bash","tool_input":{"command":"python3 plugin/harness/scripts/close-cycle.py"}}'
expect 0 '{"tool_name":"Edit","tool_input":{"file_path":"x"}}'
# fail-open: 깨진 JSON → 통과
expect 0 'not json'

[ $fail -eq 0 ] && echo "active-symlink-guard self-test: PASS"
exit $fail
```

- [ ] `chmod +x plugin/harness/hooks/test-active-symlink-guard.sh`

### Task 4.2 — 실패 확인

- [ ] `bash plugin/harness/hooks/test-active-symlink-guard.sh` → hook 없어 실패.

### Task 4.3 — active-symlink-guard.py 구현

- [ ] `plugin/harness/hooks/active-symlink-guard.py` 생성:

```python
#!/usr/bin/env python3
"""
active-symlink-guard.py — PreToolUse hook (Böckeler Sensor, Computational, 차단).

cycles/active symlink 를 Bash 로 직접 제거(rm/unlink)하려는 시도를 차단한다.
사이클 종료는 close-cycle.py 만이 정당 경로 — 그 안에서 품질 게이트(독립 리뷰 충족)를
통과해야 active 가 풀린다. 수동 rm 으로 게이트를 우회하는 길을 막는다 (#007 Full Computational).

bar.jsonl 보호 hook(hypothesis-immutability)과 *대칭*: 데이터(바)뿐 아니라
종료 행위(symlink 제거)도 정당 스크립트로만.

정직한 한계: Bash 의 rm/unlink 만, 그리고 cycles/active *그 자체*(하위 경로 아님)만 탐지.
mv · python os.unlink · find -delete · 'rm -rf cycles/active/'(후행 슬래시) 는 못 잡는다.
close-cycle.py 는 *in-process* 로 unlink 하므로 이 hook 의 대상이 아니다 (정당).

Wiring (hooks.json):
  "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command",
    "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/active-symlink-guard.py" } ] } ]

Protocol:
  exit 0 = allow, exit 2 = block. stdin JSON 파싱 실패 → exit 0 (fail-open).
"""
import json
import re
import sys

# rm 또는 unlink 가 cycles/active 를 (그 자체로 — 하위 경로 '/' 아님) 대상으로 할 때
PATTERN = re.compile(r"\b(rm|unlink)\b[^\n]*\bcycles/active(?![\w/])")


def main():
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)  # fail-open

    if not isinstance(event, dict) or event.get("tool_name") != "Bash":
        sys.exit(0)
    command = (event.get("tool_input") or {}).get("command", "")
    if not isinstance(command, str):
        sys.exit(0)

    if PATTERN.search(command):
        sys.stderr.write(
            "BLOCKED: cycles/active 를 수동 제거(rm/unlink)할 수 없습니다.\n"
            "  사이클 종료는 품질 게이트를 통과하는 close-cycle.py 만이 정당 경로:\n"
            "    python3 ${CLAUDE_PLUGIN_ROOT}/scripts/close-cycle.py\n"
            "  (독립 리뷰 verdict=pass 가 모든 바 기준에 없으면 종료가 거부됩니다 — #007.)\n"
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
```

### Task 4.4 — 통과 확인

- [ ] `bash plugin/harness/hooks/test-active-symlink-guard.sh` → `active-symlink-guard self-test: PASS`.

### Task 4.5 — hooks.json wiring

- [ ] `plugin/harness/hooks/hooks.json`의 `PreToolUse` 배열에 두 번째 블록 추가(기존 Edit|Write 블록은 유지):

```json
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/active-symlink-guard.py"
          }
        ]
      }
```

- [ ] `python3 -c "import json; json.load(open('plugin/harness/hooks/hooks.json'))"` → 파싱 OK(에러 없음).

### Task 4.6 — 커밋

- [ ] `git add plugin/harness/hooks/active-symlink-guard.py plugin/harness/hooks/test-active-symlink-guard.sh plugin/harness/hooks/hooks.json`
- [ ] 커밋: `feat(harness): active-symlink-guard blocks manual cycle close (#007 ch4)` + 트레일러.

---

## Chunk 5: F5 (active-cycle-verify 확장) + 문서/스캐폴딩

세션 밖 변조 탐지를 bar·review로 확장하고, 신규 경로를 문서·스캐폴딩에 반영.

### Task 5.1 — active-cycle-verify.py를 다중 체인으로 확장

- [ ] `plugin/harness/hooks/active-cycle-verify.py`를 아래로 교체:

```python
#!/usr/bin/env python3
"""
active-cycle-verify.py — SessionStart hook (Böckeler *Sensor*, detection).

active 사이클의 append-only 체인(hypotheses.jsonl, bar.jsonl, review.jsonl)을
세션 시작 시 verify 한다. PreToolUse hook 들은 *도구 호출*만 가로채므로
세션 *밖*(에디터 직접 수정)의 변조는 못 막는다 — 그 구멍을 이 hook 이
*다음 세션 시작 시 탐지*로 메운다 (cycle-002 F2, #007 F5: bar·review 확장).

차단이 아니라 *경고*다 (SessionStart 는 차단 개념이 없다). stdout 은 컨텍스트로
주입되어 모델/사용자가 변조를 인지한다.

Wiring (hooks.json):
  "SessionStart": [ { "hooks": [ { "type": "command",
    "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/active-cycle-verify.py" } ] } ]

Protocol:
  exit 0 always (세션 시작을 막지 않는다). stdout = 컨텍스트 주입.
"""
import os
import subprocess
import sys
from pathlib import Path

CYCLES = Path("cycles")
ACTIVE = CYCLES / "active"

# (체인 파일, 검증 스크립트, 사람이 읽을 라벨)
CHAINS = [
    ("hypotheses.jsonl", "hypothesis-register.py", "hypothesis"),
    ("bar.jsonl", "bar-register.py", "bar"),
    ("review.jsonl", "review-register.py", "review"),
]


def find_script(name: str):
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    candidates = []
    if root:
        candidates.append(Path(root) / "scripts" / name)
    candidates.append(Path(__file__).resolve().parent.parent / "scripts" / name)
    for c in candidates:
        if c.exists():
            return c
    return None


def main():
    if not ACTIVE.exists():
        sys.exit(0)

    cycle_id = Path(os.readlink(ACTIVE) if ACTIVE.is_symlink() else ACTIVE.name).name
    cdir = CYCLES / cycle_id

    checked = []
    problems = []
    for fname, script_name, label in CHAINS:
        f = cdir / fname
        if not f.exists() or f.stat().st_size == 0:
            continue  # 등록된 항목 없음 — 검증 대상 아님
        script = find_script(script_name)
        if script is None:
            continue  # fail-open — 스크립트 못 찾으면 세션 막지 않는다
        result = subprocess.run(
            [sys.executable, str(script), "verify", "--cycle", cycle_id],
            capture_output=True, text=True,
        )
        checked.append(label)
        if result.returncode != 0:
            problems.append((label, (result.stdout + result.stderr).strip()))

    if not checked:
        sys.exit(0)

    if not problems:
        print(f"[harness] active cycle '{cycle_id}': {', '.join(checked)} chain(s) intact.")
    else:
        lines = [f"[harness] ⚠️  WARNING: active cycle '{cycle_id}' chain verify FAILED:"]
        for label, detail in problems:
            lines.append(f"  - {label}: {detail}")
        lines.append(
            "  세션 밖에서 변조됐을 수 있다 (AP-06 / #006 바 낮추기). "
            "변조를 black box 에 기록하거나 원본을 복구할 것. 변경은 *새 ID 재등록 + ADR*."
        )
        print("\n".join(lines))

    sys.exit(0)


if __name__ == "__main__":
    main()
```

- [ ] 수동 확인 (intact 경로):

```bash
# tmp 사이클로 bar 등록 후 verify 경고 안 뜨는지
CID=_tmp-acv; mkdir -p cycles/$CID; : > cycles/$CID/bar.jsonl
python3 plugin/harness/scripts/bar-register.py register --cycle $CID --id B1 --criterion c --stage test --measure m >/dev/null
ln -sfn $CID cycles/active
python3 plugin/harness/hooks/active-cycle-verify.py    # 기대: "... bar chain(s) intact."
rm -f cycles/active; rm -rf cycles/$CID
```

> 주의: 위 수동 확인은 실제 active 사이클이 없을 때만 실행(있으면 `cycles/active` clobber). 있으면 생략.

### Task 5.2 — cycle-init.py: review.jsonl 스캐폴딩 + 안내

- [ ] `cycle-init.py`에서 `(cdir / "bar.jsonl").touch()` 다음 줄에 추가:

```python
    (cdir / "review.jsonl").touch()
```

- [ ] `CYCLE_CARD` 템플릿의 "Quality bar (잠금)" 줄 다음에 추가:

```
- Reviews (독립 채점): ./review.jsonl  → review-register.py 로 등록 (#007)
```

- [ ] `main()` 끝의 `print(f"  5. scripts/bar-register.py ...")` 다음에 추가:

```python
    print(f"  6. (종료 시) scripts/review-register.py 로 각 바 기준 독립 채점 → scripts/close-cycle.py 로 종료 (#007)")
```

- [ ] 확인: `python3 plugin/harness/scripts/cycle-init.py --check-wip` → exit 0/1 정상(스모크).

### Task 5.3 — hooks/README.md 문서화

- [ ] `plugin/harness/hooks/README.md`에:
  - `active-symlink-guard.py — PreToolUse` 섹션 신설(역할/막는 것/정당 경로=close-cycle.py/한계=rm·unlink만/fail-open). `hypothesis-immutability`와 *대칭* 명시.
  - `active-cycle-verify.py` 섹션의 "역할"을 "가설·바·리뷰 chain 을 verify"로 갱신(#007 F5).
  - `hypothesis-immutability.py` 섹션 "막는 것"에 `review.jsonl` 추가.
  - Self-test 블록에 추가:

```bash
# active-symlink-guard: rm cycles/active 차단 기대 (exit 2)
echo '{"tool_name":"Bash","tool_input":{"command":"rm cycles/active"}}' \
  | python3 hooks/active-symlink-guard.py; echo $?
# review.jsonl 직접편집 차단 기대 (exit 2)
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/review.jsonl"}}' \
  | python3 hooks/hypothesis-immutability.py; echo $?
```

### Task 5.4 — 13-operational-layer.md: Close 게이트 행

- [ ] `13-operational-layer.md`의 Computational 강제 표(`| WIP = 1 | ... | **Guide** ... |` 행이 있는 표)에서 WIP=1 행 *바로 다음*에 삽입:

```
| Close 게이트 | bar 전 기준에 pass 리뷰(잠긴 hash 결박) 없으면 종료 차단 | `close-cycle.py` + `active-symlink-guard` | **Sensor→Guard** (종료 전 차단) |
```

### Task 5.5 — 전체 self-test 회귀 + 커밋

- [ ] 4종 self-test 전부 PASS 확인:

```bash
bash plugin/harness/scripts/test-chainlog.sh
bash plugin/harness/scripts/test-bar-register.sh
bash plugin/harness/scripts/test-review-register.sh
bash plugin/harness/scripts/test-close-cycle.sh
bash plugin/harness/hooks/test-active-symlink-guard.sh
```

- [ ] `git add` 변경 파일 전부(`active-cycle-verify.py`, `cycle-init.py`, `hooks/README.md`, `13-operational-layer.md`)
- [ ] 커밋: `feat(harness): F5 multi-chain verify + docs/scaffolding (#007 ch5)` + 트레일러.

---

## Dogfood Ceremony (#007 사이클을 #007로 닫는다)

> 이 사이클의 *품질 바*를 이 사이클이 만든 `review-register`/`close-cycle`로 채점·종료한다 — 재귀적 자기적용(자기검증). #006이 독립 리뷰의 *가치*를 입증했다면, #007은 그 게이트가 *실제로 작동*함을 dogfood로 증명한다.

**개시(빌드 전 — 위 Chunk 실행 *전*에 사이클을 연다):**

- [ ] WIP 확인: `cd _draft/harness-engineering && python3 plugin/harness/scripts/cycle-init.py --check-wip` → "WIP OK".
- [ ] 사이클 생성: `python3 plugin/harness/scripts/cycle-init.py "independent review gate" --type dev-tool`
- [ ] `cycle-card.md` 채우기(타입 Dev-tool, appetite 2 sessions, Gate2=self-test+리뷰).
- [ ] 가설 등록(SSOT):
```bash
CID=$(readlink cycles/active)
python3 plugin/harness/scripts/hypothesis-register.py register --cycle $CID --id H1 \
  --hypothesis "review-register가 잠긴 bar에 pass 리뷰를 결박하고, close-cycle 게이트가 미충족 시 종료를 차단·충족 시 종료하며, guard가 수동 rm을 막는다. 기존 체인 회귀 0." \
  --kill-line "self-test 비통과 또는 기존 hypotheses/bar verify 회귀" \
  --pass-line "4종 self-test PASS + 회귀 0 + close 게이트 차단/통과 동작"
```
- [ ] 품질 바 잠금(이 바를 종료 시 독립 리뷰가 채점):
```bash
python3 plugin/harness/scripts/bar-register.py register --cycle $CID --id B1 --stage test \
  --criterion "신규 self-test 3종 PASS" --measure "review/close/guard test exit 0"
python3 plugin/harness/scripts/bar-register.py register --cycle $CID --id B2 --stage test \
  --criterion "기존 체인 회귀 0" --measure "chainlog/bar/hypotheses verify 여전히 OK + bar dup-id 거부"
python3 plugin/harness/scripts/bar-register.py register --cycle $CID --id B3 --stage close \
  --criterion "override/skip 0건" --measure "blackbox.jsonl 0 bytes"
```

**빌드:** 위 Chunk 1–5를 `@superpowers:subagent-driven-development`로 실행(태스크별 fresh implementer + spec·quality 2단계 리뷰).

**종료(빌드 후 — 독립 리뷰로 바 채점):**

- [ ] **fresh subagent**(doer 아님)를 띄워 B1/B2/B3를 *측정에 대고* 채점하게 한다. 그 subagent가 각 기준에 대해:
```bash
python3 plugin/harness/scripts/review-register.py register --cycle $CID --id R1 \
  --criterion-id B1 --verdict pass --evidence "test-review/close/guard 모두 exit 0 관측" --reviewer "subagent:independent-review"
# B2, B3 동일 — fail이면 fail로 정직하게 기록(그러면 close가 막힘 → 고치고 재채점 R4..)
```
- [ ] 종료: `python3 plugin/harness/scripts/close-cycle.py` — 게이트 통과 시 blackbox 제시 후 active 해제. **차단되면** 부족한 기준을 고치고 재채점 후 재시도(게이트가 실제로 작동하는 증거).
- [ ] `retro.md` 작성(살림/의심/버림 + "어긴 룰" black box 대면). dogfood 관찰: 게이트가 무엇을 잡았나/놓쳤나.
- [ ] `devils-advocate.md`에 #007 Resolution 로그 추가(②층 완성, 원칙3 "생성/평가 분리" 외부근거 연결).
- [ ] `TODO.md` 갱신: #007 → Done, #008 ratchet을 Now로, F-항목 백로그 정리.

**최종 리뷰 & 머지:** `@superpowers:finishing-a-development-branch` — 전체 구현 final code review 후 #006처럼 *사이클 1커밋*으로 main에 squash 머지, `git push skills main`.

---

## Self-test 요약 (이 계획이 추가/변경하는 검증)

| 스크립트 | 커버 |
|---|---|
| `test-review-register.sh` | 정상 등록·verify·list / 없는 criterion-id 거부 / bar_hash 결박 일치 |
| `test-bar-register.sh` (확장) | 기존 + 중복 id 거부 |
| `test-close-cycle.sh` | 리뷰 없음→차단+symlink보존 / pass→통과+symlink해제+metrics closed / 바 없음→차단 / 실제 active 있으면 SKIP |
| `test-active-symlink-guard.sh` | rm·unlink·복합명령 차단(2) / 하위경로·ls·close-cycle·다른도구 통과(0) / 깨진 JSON fail-open(0) |
| (수동) `hypothesis-immutability` | review.jsonl 직접편집 차단(2) |
| (수동) `active-cycle-verify` | bar intact 경로 경고 없음 |

**DRY/YAGNI/TDD 체크:** 체인 로직은 `chainlog` 재사용(재구현 0). 리뷰는 pass/fail 이진(불필요한 점수체계 없음). 각 태스크 실패테스트→구현→통과→커밋. fresh subagent 증명 같은 *불가능한* 보장은 시도하지 않고 한계로 명문화.
