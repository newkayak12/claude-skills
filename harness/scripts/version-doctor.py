#!/usr/bin/env python3
"""
version-doctor.py — 하네스 *버전 드리프트* 진단 (read-only, fail-open).

왜 (install 실사용 결함, #015):
  harness:install 이 "이미 완전히 설치됨"만 보고하고 *버전이 뒤처졌는지*는 침묵했다.
  사용자는 0.3.0 플러그인 + 0.3.0 벤더링으로 돌면서 최신의 게이트·보안 수정이 전부 빠진 채
  작업했다. plugin install 은 `git push` 로 자동 갱신되지 않기 때문 — 설치된 버전은 명시적
  update 전까지 동결된다. project-install.py 는 *벤더링 vs 실행 플러그인*만 비교한다(전역 플러그인
  자신이 stale 한 경우는 못 잡음). 이 스크립트가 *세 지점*의 버전을 읽어 드리프트를 표면화한다
  (거부 아님 — 정보성). harness:install Step 0.5 가 이걸 먼저 돌려 사용자에게 보고한다.

세 지점:
  1. 실행 중 플러그인 (이 스크립트가 사는 cache) — `.claude-plugin/plugin.json` 의 version.
  2. 로컬 마켓플레이스 클론이 아는 최신 — `<plugins>/marketplaces/*/.../marketplace.json` 의
     harness entry version (여러 마켓플레이스면 max).
  3. 프로젝트 벤더링 — `<proj>/.claude/harness/.harness-vendored` 의 version.

판정 (semver tuple 비교):
  - plugin < marketplace  → 전역 플러그인 stale. `/plugin` 에서 harness update.
  - vendored < plugin     → 프로젝트 벤더링 stale. harness:install 재실행(Step A 재-벤더).
  - 마켓플레이스에 harness 미등재/미상 → 마켓플레이스 클론 자체가 오래됨. `/plugin marketplace update`.
  - 마켓플레이스 클론은 origin 보다 뒤처질 수 있음(offline) → 항상 refresh 권고를 곁들인다.

fail-open: 무엇을 못 읽어도 exit 0 (진단일 뿐 차단하지 않는다). 단, --strict 면
  드리프트 감지 시 exit 1 (CI/스크립트가 게이트로 쓰고 싶을 때 opt-in).

Usage:
  version-doctor.py [--plugin-root DIR] [--project DIR] [--marketplaces DIR] [--strict]
    --plugin-root  기본 $CLAUDE_PLUGIN_ROOT, 없으면 이 스크립트의 페이로드 루트(parents[1]).
    --project      기본 $CLAUDE_PROJECT_DIR, 없으면 cwd.
    --marketplaces 기본 <plugins>/marketplaces (plugin-root 에서 'plugins' 조상으로 유도).
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

_HERE = Path(__file__).resolve()


def parse_ver(v):
    """'0.3.5' → (0,3,5). None/'?'/파싱불가 → None."""
    if not v or v == "?":
        return None
    nums = re.findall(r"\d+", str(v))
    if not nums:
        return None
    return tuple(int(n) for n in nums[:3])


def fmt(v) -> str:
    return v if v else "(미상)"


def plugin_root(arg) -> Path:
    if arg:
        return arg.resolve()
    env = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if env:
        return Path(env).resolve()
    # 이 스크립트는 평탄화 페이로드 안에 산다: <payload>/scripts/version-doctor.py
    return _HERE.parents[1]


def running_version(proot: Path) -> str:
    try:
        return json.loads(
            (proot / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        ).get("version", "?")
    except Exception:
        return "?"


def plugins_root(proot: Path) -> Path:
    """plugin-root 에서 'plugins' 조상을 찾아 그 디렉토리를 반환. 못 찾으면 ~/.claude/plugins."""
    for anc in [proot, *proot.parents]:
        if anc.name == "plugins":
            return anc
    cfg = os.environ.get("CLAUDE_CONFIG_DIR")
    base = Path(cfg) if cfg else (Path.home() / ".claude")
    return base / "plugins"


def marketplace_latest(mpdir: Path):
    """마켓플레이스 클론들에서 harness entry 버전의 max. (ver_str, source_path) 또는 None."""
    if not mpdir.is_dir():
        return None
    best = None
    best_str = None
    best_src = None
    candidates = sorted(mpdir.glob("*/.claude-plugin/marketplace.json")) + sorted(
        mpdir.glob("*/marketplace.json")
    )
    for mj in candidates:
        try:
            data = json.loads(mj.read_text(encoding="utf-8"))
        except Exception:
            continue
        for pl in data.get("plugins", []):
            if pl.get("name") != "harness":
                continue
            v = pl.get("version")
            pv = parse_ver(v)
            if pv and (best is None or pv > best):
                best, best_str, best_src = pv, v, mj
    if best_str is None:
        return None
    return (best_str, best_src)


def vendored_version(project: Path) -> str:
    marker = project / ".claude" / "harness" / ".harness-vendored"
    if not marker.exists():
        return None
    try:
        return json.loads(marker.read_text(encoding="utf-8")).get("version")
    except Exception:
        return None


def main() -> None:
    ap = argparse.ArgumentParser(description="하네스 버전 드리프트 진단 (read-only)")
    ap.add_argument("--plugin-root", type=Path, default=None)
    ap.add_argument("--project", type=Path, default=None)
    ap.add_argument("--marketplaces", type=Path, default=None)
    ap.add_argument("--strict", action="store_true",
                    help="드리프트 감지 시 exit 1 (기본은 fail-open exit 0)")
    args = ap.parse_args()

    proot = plugin_root(args.plugin_root)
    project = (args.project or Path(os.environ.get("CLAUDE_PROJECT_DIR", Path.cwd()))).resolve()
    mpdir = (args.marketplaces.resolve() if args.marketplaces else plugins_root(proot) / "marketplaces")

    run_str = running_version(proot)
    mkt = marketplace_latest(mpdir)
    mkt_str = mkt[0] if mkt else None
    ven_str = vendored_version(project)

    run_v, mkt_v, ven_v = parse_ver(run_str), parse_ver(mkt_str), parse_ver(ven_str)

    print("=== 하네스 버전 점검 (version-doctor) ===")
    print(f"  실행 중 플러그인 (cache):   v{fmt(run_str)}   <- 이 스킬/스크립트가 도는 버전")
    print(f"  마켓플레이스 등재 (cache):  v{fmt(mkt_str)}   <- 로컬 마켓플레이스 클론이 아는 최신")
    print(f"  프로젝트 벤더링:            v{fmt(ven_str)}   <- {project / '.claude' / 'harness'}")
    print()

    verdicts = []
    drift = False

    # 1) 실행 플러그인 vs 마켓플레이스 등재
    if mkt_v and run_v:
        if mkt_v > run_v:
            drift = True
            verdicts.append(
                f"⚠️ 전역 플러그인 stale: v{run_str} < v{mkt_str}. "
                f"`/plugin` 메뉴 → harness **update** (또는 uninstall→install)."
            )
        elif mkt_v == run_v:
            verdicts.append(f"✓ 전역 플러그인 최신 — 마켓플레이스 등재(v{mkt_str})와 동일.")
        else:  # run > mkt: 마켓플레이스 클론이 더 오래됨
            verdicts.append(
                f"⚠️ 마켓플레이스 클론이 실행 플러그인보다 오래됨 (등재 v{mkt_str} < 실행 v{run_str}). "
                f"클론 새로고침: `/plugin marketplace update`."
            )
    elif mkt_v is None:
        verdicts.append(
            "⚠️ 로컬 마켓플레이스 클론에 harness 미등재/미상 — 클론이 harness 추가 이전 시점일 수 있음. "
            "`/plugin marketplace update <마켓플레이스>` 후 다시 확인."
        )

    # 2) 벤더링 vs 실행 플러그인
    if ven_v and run_v:
        if ven_v < run_v:
            drift = True
            verdicts.append(
                f"⚠️ 프로젝트 벤더링 stale: v{ven_str} < 실행 v{run_str}. "
                f"이 프로젝트에서 `harness:install` 재실행(Step A 재-벤더)해야 hook 이 새 버전으로 갱신됨."
            )
        elif ven_v == run_v:
            verdicts.append(f"✓ 프로젝트 벤더링이 실행 플러그인과 동일 (v{ven_str}).")
        else:  # vendored > running: 드문 경우(전역이 더 구형)
            verdicts.append(
                f"ℹ️ 프로젝트 벤더링(v{ven_str})이 실행 플러그인(v{run_str})보다 새 버전 — "
                f"전역 플러그인을 update 하는 게 좋음."
            )
    elif ven_v is None:
        verdicts.append(
            "ℹ️ 이 프로젝트엔 벤더링 없음 — `harness:install` Step A 로 설치됨(`.claude/harness/`)."
        )

    # 3) 항상: 마켓플레이스 클론도 origin 보다 뒤처질 수 있음(offline 한계)
    verdicts.append(
        "ℹ️ 마켓플레이스 클론은 GitHub origin 보다 뒤처질 수 있음(로컬 비교만 가능). "
        "진짜 최신 확인은 `/plugin marketplace update` 로 클론을 먼저 새로고침."
    )

    for v in verdicts:
        print(f"  {v}")

    if args.strict and drift:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
