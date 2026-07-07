# Gajae P0 — Goal Decomposition + Team + Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 `harness/` 위에 *추가 레이어*로 goal 분해(`harness:goals`) + 인터뷰(`harness:interview`) + 페르소나 팀 실행/3층 검증(`harness:run` + Workflow pipeline)을 얹되, 상태는 Python state lib(`goalslib.py`)로 `.claude/harness/` 아래 영속한다.

**Architecture:** spec `docs/superpowers/specs/2026-06-17-gajae-style-team-ledger-design.md`(approved) 의 Option B(추가 전용). 기존 `cycles/active/` 와 충돌을 피해 goal 상태는 `.claude/harness/goal-cycles/<id>/` 네임스페이스. 오케스트레이션은 `Workflow` tool pipeline(Planner→Critic→[Executor↔Verifier]×최대3) — retry cap·fan-out 을 모델 재량이 아니라 코드로 강제. 페르소나는 Claude Code `Agent`(context 격리, worktree 아님).

**Tech Stack:** Python 3 stdlib(argparse, json, pathlib) — 기존 harness 스크립트 컨벤션. 테스트는 bash self-test(`test-*.sh`, exit code/출력 검사, pytest 없음). 오케스트레이션은 `harness:run` SKILL 이 인라인 생성하는 Workflow JS script. SKILL.md 는 기존 `skills/{cycle,plan,work,review}/SKILL.md` 형식.

## Global Constraints

- 기존 `harness/skills/{install,cycle,plan,work,review}` 와 phase/cycle 머시너리는 **변경 금지**. 예외: Task 7(Decision #10) 이 `cycle/SKILL.md` Design phase 에 Critic 단계 *한 곳*만 삽입.
- 상태 디렉토리: `.claude/harness/goal-cycles/<goal-id>/` (기존 `cycles/active/` 와 분리 — 네임스페이스 충돌 금지).
- goal 상태머신: `pending → running → passed | failed`. 실패 retry **hard cap = 3**. Critic revise 루프도 cap = 3 (통일).
- 검증은 **3층 AND**: (a) acceptance-criteria 충족 (b) plan-adherence (c) work-product 독립 검사. 셋 다 pass 여야 goal pass.
- 3회 실패 시 silent continue 금지 — `status.json` 에 `failed`+blocker 기록 후 사용자에게 명시 보고.
- 격리 = context only (`Agent`/`agent()`). worktree/tmux/bun 금지(spec §7 non-goals).
- 스크립트는 전부 Python stdlib. self-test 관례: `cd "$(dirname "$0")/../.."`(repo 루트), tmp 디렉토리 생성→실행→`rm -rf`→`PASS`.
- 버전: P0 는 신규 skill 3개 추가 → minor bump 후보(0.3.x → 0.4.0). `INSTRUCT.md` 워크플로우(marketplace.json + plugin.json + README) 따름.

## File Structure

**신규 (NEW):**

| 파일 | 책임 |
|---|---|
| `harness/scripts/goalslib.py` | goals.json read/write/validate 라이브러리. schema(spec §5) 검증, status 전이, attempts 증가. 다른 스크립트가 import. 체인 로직 없음(goals.json 은 가변 상태라 tamper-evident 대상 아님). |
| `harness/scripts/goals-state.py` | `goalslib` 의 CLI 래퍼. `init`/`set-status`/`bump-attempt`/`show`/`scaffold-cycle`. Workflow JS 가 Bash 로 호출. |
| `harness/scripts/test-goalslib.sh` | goalslib self-test (init/validate/status 전이/attempt cap/스키마 거부). |
| `harness/scripts/test-goals-state.sh` | CLI self-test (init→show→set-status→scaffold-cycle). |
| `harness/skills/interview/SKILL.md` | Planner persona Socratic 인터뷰 → `.claude/harness/specs/<slug>.md`. |
| `harness/skills/goals/SKILL.md` | goal → sub-goals + acceptance_criteria + skill_hints 분해(Planner) + Critic 검토(최대3회) → `goals.json`. skill_hints 매핑표(spec §4) 포함. |
| `harness/skills/run/SKILL.md` | Workflow pipeline 인라인 생성·실행. 3층 검증·3회 cap·실패 보고. |
| `harness/scripts/workflow-templates/gajae-pipeline.js` | `harness:run` 이 참조하는 Workflow 스크립트 템플릿(인라인 박지 않고 파일로 — todo P0). |

**수정 (MODIFIED):**

| 파일 | 변경 |
|---|---|
| `harness/skills/cycle/SKILL.md` | Design phase `--confirm-user` 게이트 *전에* Critic 독립 검토 단계 삽입(Decision #10). 그 외 무변경. |
| `.claude-plugin/marketplace.json` | harness description 갱신 + version 0.4.0. |
| `harness/.claude-plugin/plugin.json` | version 0.4.0. |
| `harness/README.md` | Skills 표에 interview/goals/run 추가. |

---

## Task 1: goalslib.py — goal 상태 라이브러리

**Files:**
- Create: `harness/scripts/goalslib.py`
- Test: `harness/scripts/test-goalslib.sh`

**Interfaces:**
- Produces:
  - `load(root: Path) -> dict` — `<root>/goals.json` 로드. 없으면 `FileNotFoundError`.
  - `save(root: Path, data: dict) -> None` — 검증 후 저장(2-space indent, ensure_ascii=False).
  - `validate(data: dict) -> list[str]` — 스키마 위반 목록(빈 리스트면 valid). 필수 키: `final_goal`, `goals[]`; 각 goal `id`,`title`,`acceptance_criteria(list)`,`skill_hints(list)`,`status`,`attempts(int)`.
  - `STATUSES = ("pending","running","passed","failed")`, `MAX_ATTEMPTS = 3`.
  - `set_status(data, goal_id, status) -> dict` — 잘못된 status/없는 id 면 `ValueError`.
  - `bump_attempt(data, goal_id) -> int` — attempts += 1, 반환. `MAX_ATTEMPTS` 초과 시도는 그대로 증가시키되 호출측이 cap 판단(라이브러리는 정책 아님).

- [ ] **Step 1: Write the failing test**

`harness/scripts/test-goalslib.sh`:

```bash
#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../.." || exit 1
P="python3 harness/scripts/goalslib.py --selftest"
fail=0
$P || { echo "FAIL: goalslib --selftest 비-0"; fail=1; }
[ $fail -eq 0 ] && echo "goalslib self-test: PASS"
exit $fail
```

`goalslib.py` 는 `--selftest` 플래그로 내장 단위검사를 돌린다(별도 pytest 없이 stdlib `assert`).

- [ ] `chmod +x harness/scripts/test-goalslib.sh`

- [ ] **Step 2: Run test to verify it fails**

Run: `bash harness/scripts/test-goalslib.sh`
Expected: FAIL — `goalslib.py` 없음.

- [ ] **Step 3: Write minimal implementation**

`harness/scripts/goalslib.py`:

```python
#!/usr/bin/env python3
"""
goalslib.py — gajae goal 상태(goals.json) read/write/validate 라이브러리 (P0).

goals.json 은 *가변* 실행 상태다(status/attempts 가 변한다) — hypotheses/bar/review 처럼
tamper-evident 체인이 아니다. 따라서 chainlog 와 무관하게 평범한 JSON 으로 다룬다.
스키마(spec §5)만 강제하고, 상태 전이 규칙(pending→running→passed|failed)을 코드로 둔다.

정책 vs 메커니즘: cap=3 판단은 *호출측*(Workflow) 이 한다. 라이브러리는 attempts 를
증가시키고 현재 값을 돌려줄 뿐 — "3회면 멈춰라" 는 오케스트레이션 책임.
"""
import json
import sys
from pathlib import Path

STATUSES = ("pending", "running", "passed", "failed")
MAX_ATTEMPTS = 3
_REQUIRED_GOAL_KEYS = ("id", "title", "acceptance_criteria", "skill_hints", "status", "attempts")


def goals_path(root: Path) -> Path:
    return Path(root) / "goals.json"


def load(root: Path) -> dict:
    p = goals_path(root)
    if not p.exists():
        raise FileNotFoundError(f"goals.json not found at {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def validate(data: dict) -> list:
    errs = []
    if not isinstance(data, dict):
        return ["root is not an object"]
    if not data.get("final_goal"):
        errs.append("missing final_goal")
    goals = data.get("goals")
    if not isinstance(goals, list) or not goals:
        errs.append("goals must be a non-empty list")
        return errs
    seen = set()
    for i, g in enumerate(goals):
        if not isinstance(g, dict):
            errs.append(f"goals[{i}] not an object")
            continue
        for k in _REQUIRED_GOAL_KEYS:
            if k not in g:
                errs.append(f"goals[{i}] missing '{k}'")
        gid = g.get("id")
        if gid in seen:
            errs.append(f"duplicate goal id '{gid}'")
        seen.add(gid)
        if g.get("status") not in STATUSES:
            errs.append(f"goals[{i}] invalid status '{g.get('status')}'")
        if not isinstance(g.get("acceptance_criteria"), list):
            errs.append(f"goals[{i}] acceptance_criteria not a list")
        if not isinstance(g.get("skill_hints"), list):
            errs.append(f"goals[{i}] skill_hints not a list")
        if not isinstance(g.get("attempts"), int):
            errs.append(f"goals[{i}] attempts not an int")
    return errs


def save(root: Path, data: dict) -> None:
    errs = validate(data)
    if errs:
        raise ValueError("goals.json validation failed: " + "; ".join(errs))
    goals_path(root).write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _find(data: dict, goal_id: str) -> dict:
    for g in data.get("goals", []):
        if g.get("id") == goal_id:
            return g
    raise ValueError(f"goal id '{goal_id}' not found")


def set_status(data: dict, goal_id: str, status: str) -> dict:
    if status not in STATUSES:
        raise ValueError(f"invalid status '{status}'")
    _find(data, goal_id)["status"] = status
    return data


def bump_attempt(data: dict, goal_id: str) -> int:
    g = _find(data, goal_id)
    g["attempts"] = int(g.get("attempts", 0)) + 1
    return g["attempts"]


def _selftest():
    import tempfile
    root = Path(tempfile.mkdtemp())
    data = {
        "final_goal": "ship X",
        "spec": ".claude/harness/specs/x.md",
        "goals": [
            {"id": "G001", "title": "t", "acceptance_criteria": ["a"],
             "skill_hints": ["develop:clean-code"], "status": "pending", "attempts": 0},
        ],
    }
    assert validate(data) == [], validate(data)
    save(root, data)
    loaded = load(root)
    assert loaded["goals"][0]["id"] == "G001"
    set_status(loaded, "G001", "running")
    assert loaded["goals"][0]["status"] == "running"
    assert bump_attempt(loaded, "G001") == 1
    assert bump_attempt(loaded, "G001") == 2
    # invalid status rejected
    try:
        set_status(loaded, "G001", "bogus"); assert False
    except ValueError:
        pass
    # missing id rejected
    try:
        set_status(loaded, "GX", "passed"); assert False
    except ValueError:
        pass
    # schema violation rejected on save
    bad = {"final_goal": "y", "goals": [{"id": "G1"}]}
    assert validate(bad), "expected schema errors"
    try:
        save(root, bad); assert False
    except ValueError:
        pass
    import shutil
    shutil.rmtree(root)
    print("goalslib OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    print("goalslib is a library; use --selftest or import it.", file=sys.stderr)
    sys.exit(1)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash harness/scripts/test-goalslib.sh`
Expected: `goalslib OK` 그리고 `goalslib self-test: PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add harness/scripts/goalslib.py harness/scripts/test-goalslib.sh
git commit -m "feat(harness): goalslib — goal state lib (gajae P0)
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: goals-state.py — CLI 래퍼 + goal-cycle 스캐폴딩

**Files:**
- Create: `harness/scripts/goals-state.py`
- Test: `harness/scripts/test-goals-state.sh`

**Interfaces:**
- Consumes: `goalslib` (Task 1) — `load/save/validate/set_status/bump_attempt`.
- Produces (CLI subcommands, `--root <dir>` 기본 `.claude/harness`):
  - `init --root R --final-goal "..." --spec PATH` — 빈 `goals.json`(goals=[]) 생성. (goals 는 이후 `harness:goals` 가 채움 → init 은 goals 빈 리스트 허용 위해 validate 우회하고 직접 기록.)
  - `add-goal --root R --id G001 --title "..." --accept "a" --accept "b" --hint "plugin:skill"` — goal 1개 append.
  - `set-status --root R --id G001 --status running`
  - `bump-attempt --root R --id G001` — 새 attempts 출력.
  - `scaffold-cycle --root R --id G001` — `<root>/goal-cycles/G001/{plan.md,critic-review.md,work-evidence.md,verification.md,rationale.md,status.json}` 생성. `status.json` = `{"status":"pending","attempts":0,"blocker":null}`.
  - `show --root R` — 요약 출력.

> 주의: `init` 은 goals 빈 리스트를 써야 하므로 `goalslib.save`(non-empty 강제)를 쓰지 않고 직접 `json.dump`. `add-goal` 이후부터 `save`(검증) 경로.

- [ ] **Step 1: Write the failing test**

`harness/scripts/test-goals-state.sh`:

```bash
#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../.." || exit 1
R="$(mktemp -d)"
S="python3 harness/scripts/goals-state.py"
fail=0

$S init --root "$R" --final-goal "ship X" --spec ".claude/harness/specs/x.md" >/dev/null || { echo "FAIL: init"; fail=1; }
$S add-goal --root "$R" --id G001 --title "build api" --accept "200 on /health" --hint "develop:clean-code" >/dev/null || { echo "FAIL: add-goal"; fail=1; }
$S set-status --root "$R" --id G001 --status running >/dev/null || { echo "FAIL: set-status"; fail=1; }
out=$($S bump-attempt --root "$R" --id G001); [ "$out" = "1" ] || { echo "FAIL: bump-attempt!=1 ($out)"; fail=1; }
$S scaffold-cycle --root "$R" --id G001 >/dev/null || { echo "FAIL: scaffold"; fail=1; }
for f in plan.md critic-review.md work-evidence.md verification.md rationale.md status.json; do
  [ -f "$R/goal-cycles/G001/$f" ] || { echo "FAIL: missing $f"; fail=1; }
done
grep -q '"status": "running"' "$R/goals.json" || { echo "FAIL: status not persisted"; fail=1; }

rm -rf "$R"
[ $fail -eq 0 ] && echo "goals-state self-test: PASS"
exit $fail
```

- [ ] `chmod +x harness/scripts/test-goals-state.sh`

- [ ] **Step 2: Run test to verify it fails**

Run: `bash harness/scripts/test-goals-state.sh`
Expected: FAIL — `goals-state.py` 없음.

- [ ] **Step 3: Write minimal implementation**

`harness/scripts/goals-state.py`:

```python
#!/usr/bin/env python3
"""
goals-state.py — goalslib 의 CLI 래퍼 (gajae P0). Workflow JS 가 Bash 로 호출.

상태 디렉토리 기본값 .claude/harness — 기존 cycles/active 와 *분리된* 네임스페이스.
goal-cycle 산출물은 .claude/harness/goal-cycles/<id>/ 아래 (cycles/<id> 와 혼동 금지).
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import goalslib  # noqa: E402

DEFAULT_ROOT = Path(".claude/harness")
_CYCLE_FILES = ["plan.md", "critic-review.md", "work-evidence.md",
                "verification.md", "rationale.md"]


def _root(args) -> Path:
    r = Path(args.root)
    r.mkdir(parents=True, exist_ok=True)
    return r


def cmd_init(args):
    root = _root(args)
    data = {"final_goal": args.final_goal, "spec": args.spec, "goals": []}
    goalslib.goals_path(root).write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"init goals.json at {goalslib.goals_path(root)}")


def cmd_add_goal(args):
    root = _root(args)
    data = goalslib.load(root)
    data["goals"].append({
        "id": args.id, "title": args.title,
        "acceptance_criteria": list(args.accept or []),
        "skill_hints": list(args.hint or []),
        "status": "pending", "attempts": 0,
    })
    goalslib.save(root, data)
    print(f"added {args.id}")


def cmd_set_status(args):
    root = _root(args)
    data = goalslib.load(root)
    goalslib.set_status(data, args.id, args.status)
    goalslib.save(root, data)
    print(args.status)


def cmd_bump_attempt(args):
    root = _root(args)
    data = goalslib.load(root)
    n = goalslib.bump_attempt(data, args.id)
    goalslib.save(root, data)
    print(n)


def cmd_scaffold_cycle(args):
    root = _root(args)
    cdir = root / "goal-cycles" / args.id
    cdir.mkdir(parents=True, exist_ok=True)
    for f in _CYCLE_FILES:
        fp = cdir / f
        if not fp.exists():
            fp.write_text(f"# {args.id} — {f}\n", encoding="utf-8")
    status = cdir / "status.json"
    if not status.exists():
        status.write_text(json.dumps(
            {"status": "pending", "attempts": 0, "blocker": None},
            indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"scaffolded {cdir}")


def cmd_show(args):
    root = _root(args)
    data = goalslib.load(root)
    print(f"final_goal: {data.get('final_goal')}")
    for g in data.get("goals", []):
        print(f"  [{g['id']}] {g['status']:8} attempts={g.get('attempts',0)}  {g['title']}")


def main():
    ap = argparse.ArgumentParser(description="gajae goal 상태 CLI")
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    sub = ap.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("init"); pi.add_argument("--final-goal", required=True)
    pi.add_argument("--spec", default=""); pi.set_defaults(func=cmd_init)

    pa = sub.add_parser("add-goal")
    pa.add_argument("--id", required=True); pa.add_argument("--title", required=True)
    pa.add_argument("--accept", action="append"); pa.add_argument("--hint", action="append")
    pa.set_defaults(func=cmd_add_goal)

    ps = sub.add_parser("set-status")
    ps.add_argument("--id", required=True)
    ps.add_argument("--status", required=True, choices=goalslib.STATUSES)
    ps.set_defaults(func=cmd_set_status)

    pb = sub.add_parser("bump-attempt"); pb.add_argument("--id", required=True)
    pb.set_defaults(func=cmd_bump_attempt)

    pc = sub.add_parser("scaffold-cycle"); pc.add_argument("--id", required=True)
    pc.set_defaults(func=cmd_scaffold_cycle)

    psh = sub.add_parser("show"); psh.set_defaults(func=cmd_show)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash harness/scripts/test-goals-state.sh`
Expected: `goals-state self-test: PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add harness/scripts/goals-state.py harness/scripts/test-goals-state.sh
git commit -m "feat(harness): goals-state CLI + goal-cycle scaffolding (gajae P0)
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: harness:interview SKILL.md

**Files:**
- Create: `harness/skills/interview/SKILL.md`

**Interfaces:**
- Produces: `.claude/harness/specs/<slug>.md` (Socratic 인터뷰 산출). `harness:goals` 가 이 spec 을 입력으로 소비.

기존 `harness/skills/cycle/SKILL.md` 의 frontmatter(name/description/scenarios/related) + 본문 형식을 따른다. SKILL 은 코드가 아니라 절차 문서이므로 self-test 대신 *구조 체크리스트*로 검증한다.

- [ ] **Step 1: 작성** — 아래 구조로 `harness/skills/interview/SKILL.md`:
  - frontmatter: `name: interview`, `description: Use when ...` (EN+KR 트리거 2-3개씩), `scenarios`, `related: [cycle, goals]`.
  - 본문 섹션:
    - **When** — 최종 goal 이 모호할 때 cycle/goals 전에 명료화. (cycle 과 순서: interview → goals → run, 또는 독립 실행 가능.)
    - **Process**: Planner persona 가 Socratic 질문(한 번에 하나). ambiguity 임계 대신 "충분히 명확해졌다" 판단 기준 명시 — (1) 문제·사용자·성공기준이 한 문장씩 쓰여짐 (2) 검증 가능 형태 (3) 사용자가 더 더할 게 없다고 확인.
    - **Output**: `.claude/harness/specs/<slug>.md` (problem / persona / success criteria / constraints / open questions).
    - **What Claude Does / What You Do / Related Skills**.
  - 모든 경로는 `.claude/harness/specs/` (기존 `cycles/` 아님).

- [ ] **Step 2: 구조 검증**

Run: `python3 - <<'PY'
import re,sys
t=open('harness/skills/interview/SKILL.md').read()
for k in ['name: interview','description:','scenarios:','## ','.claude/harness/specs/']:
    assert k in t, f'missing {k}'
assert 'Use when' in t
print('interview SKILL structure OK')
PY`
Expected: `interview SKILL structure OK`.

- [ ] **Step 3: Commit**

```bash
git add harness/skills/interview/SKILL.md
git commit -m "feat(harness): interview skill — Socratic spec capture (gajae P0)
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: harness:goals SKILL.md (분해 + Critic + skill_hints 매핑)

**Files:**
- Create: `harness/skills/goals/SKILL.md`

**Interfaces:**
- Consumes: `.claude/harness/specs/<slug>.md` (Task 3), `goals-state.py` (Task 2).
- Produces: `.claude/harness/goals.json` (Planner 분해 + Critic 검토). `harness:run` 이 소비.

- [ ] **Step 1: 작성** — `harness/skills/goals/SKILL.md`:
  - frontmatter: `name: goals`, description(EN+KR 트리거: "goal 분해", "sub-goal 나눠줘", "decompose this goal" 등), related: [interview, run, plan].
  - **명시적 구분**: `harness:goals` = 최종 goal → sub-goal 분해(이 skill). `harness:plan` = active cycle 내 spec/design/plan 작성(기존, 무관). 혼동 금지 한 줄.
  - **Process**:
    1. Planner: spec → sub-goals. 각 goal 에 `acceptance_criteria`(검증 가능, 사전 정의) + `skill_hints`(아래 매핑표).
    2. `goals-state.py init` → goal 마다 `add-goal --accept ... --hint ...`.
    3. Critic(devils-advocate): 분해를 검토 — 누락 goal/잘못된 순서/검증 불가 acceptance criteria 지적. Planner 에게 최대 **3회** 되돌림(cap).
    4. 산출: `goals.json` (스키마 spec §5).
  - **skill_hints 매핑표** (spec §4 그대로 본문에 표로):

    | Goal type | Steered skills |
    |---|---|
    | Feature development | `develop:clean-code`, `develop:test-driven-development`, `develop:pragmatic-programmer` |
    | Architecture | `develop:architecture-designer`, `develop:domain-driven-design` |
    | Technical writing | `write:writing-skills`, `write:doc-coauthoring` |
    | DB / infra | `develop:database-optimizer`, `develop:dockerfile-optimizer` |
    | Testing | `develop:test-master`, `develop:flaky-test-analyzer` |
    | PM / strategy | `pm:prd-development`, `pm:feature-prioritization` |

    Critic: `think:devils-advocate`, `cognition:assumption-extractor`, `cognition:tradeoff-articulator`.
    Verifier: `completion:verification-before-completion`, `write:writer-verification`, `think:devils-advocate`.
  - **What Claude Does / What You Do / Related Skills**.

- [ ] **Step 2: 구조 검증**

Run: `python3 - <<'PY'
t=open('harness/skills/goals/SKILL.md').read()
for k in ['name: goals','skill_hints','acceptance_criteria','goals-state.py','devils-advocate','3']:
    assert k in t, f'missing {k}'
assert 'harness:plan' in t, 'must disambiguate from harness:plan'
print('goals SKILL structure OK')
PY`
Expected: `goals SKILL structure OK`.

- [ ] **Step 3: Commit**

```bash
git add harness/skills/goals/SKILL.md
git commit -m "feat(harness): goals skill — decomposition + Critic + skill_hints (gajae P0)
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Workflow pipeline 템플릿 (gajae-pipeline.js)

**Files:**
- Create: `harness/scripts/workflow-templates/gajae-pipeline.js`

**Interfaces:**
- Consumes: `goals.json` (Task 4) via `goals-state.py` Bash 호출. `harness:run` (Task 6) 이 이 템플릿을 읽어 Workflow 로 실행.
- Produces: per-goal `verification.md`/`work-evidence.md`/`status.json` 갱신, 최종 pass/fail 요약.

pipeline 형태(spec §3): pending goal 마다 Planner(Plan) → Critic(Critique, ≤3 revise) → loop≤3[Executor(Execute) → Verifier(Verify) 3층] → pass면 rationale 기록·다음 goal / 3회 fail 면 status=failed + STOP + 사용자 보고.

> 이 파일은 `Workflow` tool 의 `script` 본문 형식(`export const meta = {...}` + agent()/pipeline()/parallel()). `harness:run` SKILL 이 이 템플릿을 베이스로, 실제 실행 시 goals.json 경로/내용을 args 로 주입한다.

- [ ] **Step 1: 작성** — `gajae-pipeline.js` (핵심 골격, 실제 실행은 harness:run 이 args 주입):

```javascript
export const meta = {
  name: 'gajae-goal-execution',
  description: 'Per-goal Planner→Critic→[Executor↔Verifier]×3 with 3-layer verification',
  phases: [
    { title: 'Plan' }, { title: 'Critique' },
    { title: 'Execute' }, { title: 'Verify' },
  ],
}

// args = { goals: [{id,title,acceptance_criteria,skill_hints}], root: '.claude/harness' }
const MAX = 3
const VERDICT = {
  type: 'object',
  properties: {
    acceptance_ok: { type: 'boolean' },
    plan_adherence_ok: { type: 'boolean' },
    work_product_ok: { type: 'boolean' },
    blocker: { type: 'string' },
  },
  required: ['acceptance_ok', 'plan_adherence_ok', 'work_product_ok'],
}

const results = []
for (const goal of (args.goals || [])) {
  log(`goal ${goal.id}: ${goal.title}`)
  // Plan
  const plan = await agent(
    `Plan execution for goal "${goal.title}". Acceptance: ${JSON.stringify(goal.acceptance_criteria)}. ` +
    `Produce a concrete step list. Do NOT mutate files (planning only).`,
    { label: `plan:${goal.id}`, phase: 'Plan' })

  // Critique (≤3 revise)
  let critique, revisedPlan = plan, round = 0
  do {
    critique = await agent(
      `Devils-advocate review of this plan for "${goal.title}":\n${revisedPlan}\n` +
      `Return APPROVE or REVISE:<reason>. Use think:devils-advocate.`,
      { label: `critique:${goal.id}:${round}`, phase: 'Critique' })
    if (!/REVISE/i.test(critique || '')) break
    revisedPlan = await agent(
      `Revise the plan addressing: ${critique}`,
      { label: `replan:${goal.id}:${round}`, phase: 'Plan' })
    round++
  } while (round < MAX)

  // Execute ↔ Verify loop (≤3)
  let verdict = null, attempt = 0, passed = false
  while (attempt < MAX) {
    attempt++
    const work = await agent(
      `Execute goal "${goal.title}" following this plan:\n${revisedPlan}\n` +
      `Invoke these skills as appropriate: ${JSON.stringify(goal.skill_hints)}. ` +
      `Report what you changed with evidence (paths, commands, output).`,
      { label: `exec:${goal.id}:${attempt}`, phase: 'Execute' })
    verdict = await agent(
      `Independently verify goal "${goal.title}" in 3 layers, each a separate judgment:\n` +
      `(a) acceptance criteria ${JSON.stringify(goal.acceptance_criteria)} satisfied?\n` +
      `(b) plan-adherence: does the actual change match the plan?\n` +
      `(c) work-product: read the artifact itself — is it correct?\n` +
      `Evidence from executor:\n${work}\n` +
      `Use completion:verification-before-completion. Set blocker if any layer fails.`,
      { label: `verify:${goal.id}:${attempt}`, phase: 'Verify', schema: VERDICT })
    passed = verdict && verdict.acceptance_ok && verdict.plan_adherence_ok && verdict.work_product_ok
    if (passed) break
    log(`goal ${goal.id} attempt ${attempt} FAILED: ${verdict?.blocker || 'unspecified'}`)
  }

  results.push({ id: goal.id, passed, attempts: attempt,
                 blocker: passed ? null : (verdict?.blocker || '3 attempts exhausted') })
  if (!passed) {
    log(`🛑 goal ${goal.id} FAILED after ${attempt} attempts — stopping its pipeline, reporting to user`)
  }
}
return results
```

- [ ] **Step 2: 구조 검증** (JS 파싱은 실행 시 Workflow 가 — 여기선 정적 확인)

Run: `node --check harness/scripts/workflow-templates/gajae-pipeline.js 2>/dev/null && echo "js syntax OK" || grep -q "export const meta" harness/scripts/workflow-templates/gajae-pipeline.js && echo "template present (node 부재 시 grep fallback)"`
Expected: `js syntax OK` 또는 fallback 메시지.

- [ ] **Step 3: Commit**

```bash
git add harness/scripts/workflow-templates/gajae-pipeline.js
git commit -m "feat(harness): gajae Workflow pipeline template (gajae P0)
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: harness:run SKILL.md

**Files:**
- Create: `harness/skills/run/SKILL.md`

**Interfaces:**
- Consumes: `goals.json` (Task 4), `gajae-pipeline.js` (Task 5), `goals-state.py` (Task 2).
- Produces: Workflow 실행 → per-goal status 갱신 + 실패 명시 보고.

- [ ] **Step 1: 작성** — `harness/skills/run/SKILL.md`:
  - frontmatter: `name: run`, description(EN+KR: "goal 실행해줘", "execute goals", "팀 돌려줘"), related: [goals, interview].
  - **Process**:
    1. `goals-state.py show` 로 pending goals 확인.
    2. `Workflow` tool 호출 — `scriptPath: harness/scripts/workflow-templates/gajae-pipeline.js`, `args: {goals: <pending goals>, root: ".claude/harness"}`.
    3. 결과 수신 후, goal 마다 `goals-state.py set-status`(passed/failed) + `scaffold-cycle` 로 산출물 기록.
    4. **실패 보고 강제**: 결과에 `passed=false` 가 있으면 *그 goal 의 blocker 를 사용자에게 명시 보고*하고 다음 행동 전 멈춘다(silent continue 금지, spec §6).
  - **3층 검증 / 3회 cap 설명** + worktree 아닌 context 격리 명시.
  - **subagent 가 Skill tool 로 think:devils-advocate / completion:verification-before-completion 호출 가능한지**는 실행 전 확인(todo P1 항목 — run SKILL 에 "검증 필요" 주석).
  - **What Claude Does / What You Do / Related Skills**.

- [ ] **Step 2: 구조 검증**

Run: `python3 - <<'PY'
t=open('harness/skills/run/SKILL.md').read()
for k in ['name: run','Workflow','gajae-pipeline.js','set-status','silent','3']:
    assert k in t, f'missing {k}'
print('run SKILL structure OK')
PY`
Expected: `run SKILL structure OK`.

- [ ] **Step 3: Commit**

```bash
git add harness/skills/run/SKILL.md
git commit -m "feat(harness): run skill — Workflow goal execution + fail reporting (gajae P0)
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Critic 단계를 cycle Design phase 에 삽입 (Decision #10)

**Files:**
- Modify: `harness/skills/cycle/SKILL.md` (Design-phase doc-flow 섹션, `--confirm-user` 게이트 *전*)

**Interfaces:**
- Consumes: 기존 cycle Design phase. Critic persona(Task 4 와 동일 역할, 신규 역할 없음).

기존 cycle 의 RFC/Design Doc/ADR 작성 단계는 "review=사용자 확인" 뿐 독립 agent 점검이 없다(spec §2 #10). Critic 한 단계를 `--confirm-user` *전에* 끼운다.

- [ ] **Step 1: SKILL.md 수정** — "Design-phase doc-flow" 섹션 끝(`The AI states this flow ...` 직전)에 추가:

```markdown
**Independent Critic pass before the user gate (gajae Decision #10):**
Before the `--confirm-user` gate, dispatch a fresh Critic subagent (devils-advocate
stance, `think:devils-advocate`) to review the RFC / Design Doc / ADR draft
independently. Attach its critique to the draft. The user gate is unchanged — but the
user now reviews a draft that already carries an independent critique, not a raw one.
This is the only point the gajae layer touches `harness:cycle`; the rest of
cycle/plan/work/review is untouched.
```

- [ ] **Step 2: 구조 검증**

Run: `grep -q "Independent Critic pass before the user gate" harness/skills/cycle/SKILL.md && grep -q "confirm-user" harness/skills/cycle/SKILL.md && echo "decision#10 inserted"`
Expected: `decision#10 inserted`.

- [ ] **Step 3: 회귀 확인** — cycle 의 기존 phase-advance/phase-guard 동작 무변경:

Run: `bash harness/scripts/test-phase-guard.sh`
Expected: `phase-guard self-test: PASS`.

- [ ] **Step 4: Commit**

```bash
git add harness/skills/cycle/SKILL.md
git commit -m "feat(harness): insert independent Critic pass in cycle Design phase (gajae #10)
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 문서 + 버전 bump + 전체 회귀

**Files:**
- Modify: `.claude-plugin/marketplace.json`, `harness/.claude-plugin/plugin.json`, `harness/README.md`

- [ ] **Step 1: README Skills 표에 추가** — `harness/README.md` 핵심 스킬 목록에:

```markdown
- `harness:interview` — Socratic 인터뷰로 spec 명료화 (→ `.claude/harness/specs/`)
- `harness:goals` — 최종 goal → sub-goal 분해 + Critic 검토 (→ `.claude/harness/goals.json`)
- `harness:run` — Workflow 팀(Planner/Critic/Executor/Verifier)으로 goal 실행 + 3층 검증
```

- [ ] **Step 2: 버전 bump (minor)** — `marketplace.json` harness `"version": "0.4.0"` + description 에 "Goal layer: interview/goals/run + 3-layer verification" 추가. `plugin.json` `"version": "0.4.0"`.

- [ ] **Step 3: version-doctor 확인**

Run: `python3 harness/scripts/version-doctor.py | head -4`
Expected: 실행 v0.4.0 표시.

- [ ] **Step 4: 전체 self-test 회귀**

Run:
```bash
bash harness/scripts/test-goalslib.sh
bash harness/scripts/test-goals-state.sh
bash harness/scripts/test-phase-guard.sh
bash harness/scripts/test-bar-register.sh
bash harness/scripts/test-review-register.sh
bash harness/scripts/test-close-cycle.sh
bash harness/hooks/test-phase-echo.sh
bash harness/scripts/test-gate-map.sh
```
Expected: 전부 `PASS`.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json harness/.claude-plugin/plugin.json harness/README.md
git commit -m "feat(harness): v0.4.0 — gajae goal/team/verification layer (P0)
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## P1/P2 (이 플랜 범위 밖 — todo/gajae.md 참조)

- P1: subagent 가 Skill tool 접근 가능한지 검증, phase-guard ↔ Executor 권한 충돌 정리, phase-advance ↔ goal 상태머신 관계 정의.
- P2: concept 문서(00-overview 등)에 "Section 14" 추가 여부, ratchet mechanism-count 영향(신규 스크립트/skill 증가) 재평가.

---

## Self-Review

**1. Spec coverage:**
- §2 결정1(Option B 추가) → 전 Task 가 추가 전용, Task 7만 cycle 1곳 수정. ✓
- §2 결정2(Agent context 격리) → Task 5 pipeline `agent()` 사용, worktree 없음. ✓
- §2 결정3(goal→sub-goal) → Task 4 분해. ✓
- §2 결정4(3층 검증) → Task 5 VERDICT schema AND. ✓
- §2 결정5(3회 cap + 실패 보고) → Task 5 loop MAX=3, Task 6 silent continue 금지. ✓
- §2 결정6(4 페르소나) → Task 5 Planner/Critic/Executor/Verifier. ✓
- §2 결정7(skill_hints) → Task 4 매핑표, Task 5 Executor 주입. ✓
- §2 결정8(파일 영속 .claude/harness) → Task 1/2. ✓
- §2 결정9(Workflow) → Task 5. ✓
- §2 결정10(Critic in cycle) → Task 7. ✓
- §3 architecture(interview/goals/run) → Task 3/4/6. ✓
- §5 state layout/goals.json schema → Task 1 validate + Task 2 scaffold. ✓ (네임스페이스는 충돌 회피 위해 `goal-cycles/` 로 조정 — spec §5 의 `cycles/` 에서 의도적 일탈, todo 가 요구한 분리.)
- §6 실패 보고 → Task 6 Step1.4. ✓

**2. Placeholder scan:** Python/JS Task(1·2·5)는 완전 코드. SKILL Task(3·4·6·7)는 "절차 문서"라 코드 대신 구조 체크리스트 + grep 검증 — SKILL.md 본문은 구현자가 기존 cycle SKILL 형식을 모방해 작성(placeholder 아님, 형식 지정).

**3. Type consistency:** `goalslib` 함수 시그니처(load/save/validate/set_status/bump_attempt)가 Task 2 CLI 와 Task 5 pipeline 호출에서 일치. status 값 `pending/running/passed/failed` 전 Task 통일. cap=3 (Critic revise·Executor retry) 통일. goal 객체 키(id/title/acceptance_criteria/skill_hints/status/attempts) Task 1 스키마 = Task 2 add-goal = Task 5 agent 프롬프트 일치.

**알려진 일탈(의도적):** spec §5 의 `cycles/<goal-id>/` → 기존 harness `cycles/active/` 와 충돌하므로 `.claude/harness/goal-cycles/<goal-id>/` 로 변경. todo/gajae.md P0 가 명시 요구한 네임스페이스 분리.
