#!/usr/bin/env python3
"""
token-profile.py — SessionStart 주입 표면의 토큰 프로파일러 (토큰 경량화 측정 도구).

rule-inject.py(SessionStart hook)는 매 세션 `rules-merge effective`를 컨텍스트로 흘린다.
draft 레이아웃은 L0(06-rules.md)을 *플러그인 밖*에 두므로 draft에서 직접 재면 L0=0 →
실제 설치(EXPORT) 컨텍스트와 다르다(#007형 사각). 그래서 draft에서는 hermetic tmp로
export한 뒤 그 안에서 측정한다. 이미 평탄화된 설치 payload 안에서는 현재 payload를 직접
측정한다 — 둘 다 진짜 설치 표면을 본다.

측정 대상(빈 L1 기준):
  - rule-inject.py 전체 출력 (chars + ~tokens=chars/4)  ← 세션당 실제 주입량
  - rules-merge effective 본문 크기 + stage별 크기(L0 로딩시점에서 stage 자동 발견)
  - 주입 룰 수 + layer(L0/L1)·scope(invariant/default) 분해

토큰 추정은 chars/4 근사(설치 의존성 0, 도구·모델 무관). 절대값이 아니라 *축*으로 쓴다.
"chars"는 UTF-8 *바이트* 길이로 센다 — CJK는 char당 3바이트라 byte≈tokenizer 입력에 더 가깝고,
경량화 노력의 합의된 baseline(766 ~tokens = 3065 chars)과 같은 축이 된다.

축 신뢰성 (#008 ratchet lock 의 전제 — 왜 실토크나이저를 쓰지 *않는가*):
  이 값은 inject-tokens *상대 ratchet 축*이다. ratchet 이 필요로 하는 건 절대 토큰 정확도가
  아니라 *같은-방법의 cross-cycle 일관성*이다. bytes/4 는 (1) 결정론적(같은 입력→같은 값)이고
  (2) 콘텐츠에 단조 증가(텍스트가 늘면 byte 가 늘고 값이 큰다) → 이 축의 회귀는 실제 주입
  표면 회귀를 신뢰성 있게 가리킨다. 정확도가 아니라 단조성이 lock 의 근거다.
  실토크나이저는 의도적으로 *안 쓴다*: Claude 토크나이저는 의존성-경량 공개 패키지가 없고,
  tiktoken(OpenAI) 을 써도 *다른 모델의 근사*일 뿐 + 무의존성 설계를 깬다. ratchet 은 상대
  일관성만 필요하므로 절대 토크나이저는 lock 에 아무 이득이 없다(분석: 20260606-ratchet-axis-lock).

사용:
  token-profile.py              # 전체 프로파일 리포트 (exit 0)
  token-profile.py --baseline   # 헤드라인 한 줄(주입 ~tokens) — ratchet 축 값
  token-profile.py --stage <s>  # 그 stage 기준으로 effective 표면 측정
"""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

_HERE = Path(__file__).resolve()
EXPORT_SCRIPT = _HERE.parent / "harness-export.py"
PAYLOAD_ROOT = _HERE.parents[1]

CHARS_PER_TOKEN = 4  # 거친 근사 — 절대 토큰이 아니라 축(axis)으로 사용


def _tokens(chars: int) -> int:
    return (chars + CHARS_PER_TOKEN - 1) // CHARS_PER_TOKEN


def _nbytes(s: str) -> int:
    """UTF-8 바이트 길이 — CJK는 char당 3B라 byte≈tokenizer 입력에 더 가깝다."""
    return len(s.encode("utf-8"))


def _run(argv, env):
    """capture-run; (rc, stdout)."""
    r = subprocess.run(argv, capture_output=True, text=True, env=env)
    return r.returncode, r.stdout


def _discover_stages(rules_merge: Path, env) -> list:
    """L0 룰의 stage 집합을 ruleslib로 발견(파서 중복 금지 — 엔진 재사용)."""
    code = (
        "import sys,os;"
        f"sys.path.insert(0, {str(rules_merge.parent)!r});"
        "import ruleslib;"
        f"l0=os.path.join({str(rules_merge.parent.parent)!r}, '06-rules.md');"
        "rs=ruleslib.parse_l0(open(l0,encoding='utf-8').read()) if os.path.exists(l0) else [];"
        "s=set();[s.update(r['stages']) for r in rs];"
        "print('\\n'.join(sorted(x for x in s if x not in ('always','*'))))"
    )
    rc, out = _run([sys.executable, "-c", code], env)
    if rc != 0:
        return []
    return [ln.strip() for ln in out.splitlines() if ln.strip()]


def _breakdown(rules_merge: Path, env, stage=None) -> dict:
    """effective set의 layer·scope 분해를 ruleslib merge로 직접 계산(엔진 재사용)."""
    stage_arg = repr(stage) if stage else "None"
    code = (
        "import sys,os;"
        f"sys.path.insert(0, {str(rules_merge.parent)!r});"
        "import ruleslib;"
        f"l0=os.path.join({str(rules_merge.parent.parent)!r}, '06-rules.md');"
        "home=os.environ.get('HARNESS_HOME', os.path.expanduser('~/.harness'));"
        "l1=os.path.join(home,'user-rules.md');"
        "rules=ruleslib.load_layers(l0 if os.path.exists(l0) else None, l1 if os.path.exists(l1) else None);"
        f"eff,_=ruleslib.merge(rules, stage={stage_arg});"
        "from collections import Counter;"
        "lc=Counter(r['layer'] for r in eff);"
        "sc=Counter(r['scope'] for r in eff);"
        "print('TOTAL', len(eff));"
        "[print('LAYER', k, v) for k,v in sorted(lc.items())];"
        "[print('SCOPE', k, v) for k,v in sorted(sc.items())]"
    )
    rc, out = _run([sys.executable, "-c", code], env)
    res = {"total": 0, "layer": {}, "scope": {}}
    if rc != 0:
        return res
    for ln in out.splitlines():
        parts = ln.split()
        if parts and parts[0] == "TOTAL":
            res["total"] = int(parts[1])
        elif parts and parts[0] == "LAYER":
            res["layer"][parts[1]] = int(parts[2])
        elif parts and parts[0] == "SCOPE":
            res["scope"][parts[1]] = int(parts[2])
    return res


def _measure(stage=None):
    """hermetic 빈 L1 환경에서 설치 주입 표면을 측정 → dict."""
    tmp = Path(tempfile.mkdtemp())
    if EXPORT_SCRIPT.exists():
        dest = tmp / "harness"
        rc, _out = _run([sys.executable, str(EXPORT_SCRIPT), "--dest", str(dest)], os.environ.copy())
        if rc != 0:
            print(f"ERROR: export 실패 (rc={rc})", file=sys.stderr)
            sys.exit(1)
    else:
        dest = PAYLOAD_ROOT
        if not (dest / "06-rules.md").exists():
            print(f"ERROR: 평탄화 payload 아님: {dest}", file=sys.stderr)
            sys.exit(1)

    inject = dest / "hooks" / "rule-inject.py"
    merge = dest / "scripts" / "rules-merge.py"

    # 빈 L1 — 실제 신규 설치 직후 컨텍스트(L1 user-rules 아직 없음)
    empty_home = tmp / ".harness"
    env = os.environ.copy()
    env["HARNESS_HOME"] = str(empty_home)

    _, inj = _run([sys.executable, str(inject)], env)
    eff_argv = [sys.executable, str(merge), "effective"]
    if stage:
        eff_argv += ["--stage", stage]
    _, eff = _run(eff_argv, env)

    stages = _discover_stages(merge, env)
    per_stage = {}
    for st in stages:
        _, body = _run([sys.executable, str(merge), "effective", "--stage", st], env)
        per_stage[st] = _nbytes(body)

    return {
        "dest": dest,
        "inject_chars": _nbytes(inj),
        "effective_chars": _nbytes(eff),
        "breakdown": _breakdown(merge, env, stage=stage),
        "stages": per_stage,
        "stage": stage,
    }


def _row(label, chars, count):
    rc = "" if count is None else str(count)
    return f"  {label:<34} {chars:>7} {_tokens(chars):>9} {rc:>6}"


def main():
    ap = argparse.ArgumentParser(description="SessionStart 주입 표면 토큰 프로파일러")
    ap.add_argument("--baseline", action="store_true",
                    help="헤드라인 한 줄(주입 ~tokens) — ratchet 축 값")
    ap.add_argument("--stage", help="이 stage 기준 effective 표면 측정")
    args = ap.parse_args()

    m = _measure(stage=args.stage)

    if args.baseline:
        print(_tokens(m["inject_chars"]))
        sys.exit(0)

    bd = m["breakdown"]
    print("=== token-profile: SessionStart 주입 표면 (hermetic export · 빈 L1) ===")
    print(f"chars=UTF-8 bytes · ~tokens=chars/{CHARS_PER_TOKEN}"
          + (f" · stage={m['stage']}" if m["stage"] else " · stage=all"))
    print()
    print(f"  {'surface':<34} {'chars':>7} {'~tokens':>9} {'rules':>6}")
    print(f"  {'-'*34} {'-'*7} {'-'*9} {'-'*6}")
    print(_row("rule-inject.py (세션 주입 총량)", m["inject_chars"], bd["total"]))
    print(_row("rules-merge effective (본문)", m["effective_chars"], bd["total"]))
    print()

    print("  layer 분해:  " + (", ".join(f"{k}={v}" for k, v in sorted(bd["layer"].items())) or "(없음)"))
    print("  scope 분해:  " + (", ".join(f"{k}={v}" for k, v in sorted(bd["scope"].items())) or "(없음)"))
    print()

    if m["stages"]:
        print("  stage별 effective (본문 chars · ~tokens):")
        for st, ch in sorted(m["stages"].items(), key=lambda kv: -kv[1]):
            print(f"    {st:<22} {ch:>6}  ~{_tokens(ch):>5}")
    else:
        print("  (stage 발견 안 됨 — L0 비어있거나 로딩시점 마커 없음)")

    print()
    print(f"  HEADLINE 주입 ~tokens = {_tokens(m['inject_chars'])}  (--baseline 와 동일)")
    sys.exit(0)


if __name__ == "__main__":
    main()
