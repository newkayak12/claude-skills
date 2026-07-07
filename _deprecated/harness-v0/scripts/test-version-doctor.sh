#!/usr/bin/env bash
# test-version-doctor.sh — 버전 드리프트 진단 (read-only, fail-open) #015.
# hermetic: tmp 레이아웃으로 실제 ~/.claude 오염 0. 모든 입력을 플래그로 주입.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DOC="$HERE/version-doctor.py"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $1"; exit 1; }

# --- tmp 플러그인 cache(실행 버전) + 마켓플레이스 클론 + 프로젝트 벤더링 레이아웃 구성 ---
mk_plugin() {  # $1=dir $2=version
  mkdir -p "$1/.claude-plugin"
  printf '{"name":"harness","version":"%s"}\n' "$2" > "$1/.claude-plugin/plugin.json"
}
mk_market() {  # $1=marketplaces-dir $2=mp-name $3=harness-version
  mkdir -p "$1/$2/.claude-plugin"
  printf '{"name":"%s","plugins":[{"name":"harness","version":"%s"}]}\n' "$2" "$3" \
    > "$1/$2/.claude-plugin/marketplace.json"
}
mk_vendor() {  # $1=project-dir $2=version
  mkdir -p "$1/.claude/harness"
  printf '{"version":"%s"}\n' "$2" > "$1/.claude/harness/.harness-vendored"
}

PLUGIN="$TMP/cache/harness/0.3.0"; mk_plugin "$PLUGIN" "0.3.0"
MPDIR="$TMP/marketplaces"
PROJ="$TMP/proj"

# --- case 1: 전역 플러그인 stale (실행 0.3.0 < 마켓 0.3.5); 벤더링은 실행과 동일(0.3.0) ---
#   → 올바른 체인: 플러그인 먼저 update → 그 다음 재-벤더. 벤더링은 실행 대비 stale 아님.
mk_market "$MPDIR" "newkayak12-claude-skills" "0.3.5"
mk_vendor "$PROJ" "0.3.0"
OUT="$(python3 "$DOC" --plugin-root "$PLUGIN" --project "$PROJ" --marketplaces "$MPDIR" 2>&1)" \
  || fail "기본 모드는 fail-open(exit 0)이어야 함"
echo "$OUT" | grep -q "v0.3.0" || fail "실행 버전 표시 누락"
echo "$OUT" | grep -q "v0.3.5" || fail "마켓플레이스 버전 표시 누락"
echo "$OUT" | grep -q "전역 플러그인 stale" || fail "플러그인 stale 판정 누락"
echo "$OUT" | grep -q "벤더링이 실행 플러그인과 동일" || fail "벤더링=실행 판정 누락"

# --- case 1b: --strict 면 드리프트 시 exit 1 ---
if python3 "$DOC" --plugin-root "$PLUGIN" --project "$PROJ" --marketplaces "$MPDIR" --strict >/dev/null 2>&1; then
  fail "--strict 인데 드리프트에도 exit 0"
fi

# --- case 1c: 벤더링 stale (실행 0.3.5 > 벤더 0.3.0) → 재-벤더 권고 ---
PLUGIN_NEW="$TMP/cache/harness/0.3.5b"; mk_plugin "$PLUGIN_NEW" "0.3.5"
OUTV="$(python3 "$DOC" --plugin-root "$PLUGIN_NEW" --project "$PROJ" --marketplaces "$MPDIR" 2>&1)"
echo "$OUTV" | grep -q "프로젝트 벤더링 stale" || fail "벤더링 stale 판정 누락(실행>벤더)"
if python3 "$DOC" --plugin-root "$PLUGIN_NEW" --project "$PROJ" --marketplaces "$MPDIR" --strict >/dev/null 2>&1; then
  fail "벤더링 stale 인데 --strict exit 0"
fi

# --- case 2: 전부 최신 (실행=마켓=벤더=0.3.5) → 드리프트 없음 ---
PLUGIN2="$TMP/cache/harness/0.3.5"; mk_plugin "$PLUGIN2" "0.3.5"
PROJ2="$TMP/proj2"; mk_vendor "$PROJ2" "0.3.5"
OUT2="$(python3 "$DOC" --plugin-root "$PLUGIN2" --project "$PROJ2" --marketplaces "$MPDIR" 2>&1)"
echo "$OUT2" | grep -q "전역 플러그인 최신" || fail "최신인데 최신 판정 안 나옴"
echo "$OUT2" | grep -q "프로젝트 벤더링이 실행 플러그인과 동일" || fail "벤더링 동일 판정 누락"
python3 "$DOC" --plugin-root "$PLUGIN2" --project "$PROJ2" --marketplaces "$MPDIR" --strict >/dev/null 2>&1 \
  || fail "최신인데 --strict 가 exit 1 (드리프트 없음인데 실패 처리)"

# --- case 3: 마켓플레이스에 harness 미등재(클론이 오래됨) → 경고, 여전히 exit 0 ---
MPDIR3="$TMP/marketplaces3"
mkdir -p "$MPDIR3/old-mp/.claude-plugin"
printf '{"name":"old-mp","plugins":[{"name":"newkayak12-skills","version":"1.0.0"}]}\n' \
  > "$MPDIR3/old-mp/.claude-plugin/marketplace.json"
OUT3="$(python3 "$DOC" --plugin-root "$PLUGIN" --project "$PROJ" --marketplaces "$MPDIR3" 2>&1)" \
  || fail "marketplace 미등재여도 fail-open 이어야 함"
echo "$OUT3" | grep -q "미등재/미상" || fail "harness 미등재 경고 누락"

# --- case 4: 벤더링 없는 프로젝트 → 안내만, exit 0 ---
PROJ4="$TMP/proj4"; mkdir -p "$PROJ4"
OUT4="$(python3 "$DOC" --plugin-root "$PLUGIN2" --project "$PROJ4" --marketplaces "$MPDIR" 2>&1)" \
  || fail "벤더링 없는 프로젝트에서 fail-open 이어야 함"
echo "$OUT4" | grep -q "벤더링 없음" || fail "벤더링 없음 안내 누락"

# --- case 5: 깨진 입력(읽기 실패) 도 fail-open ---
BADPLUGIN="$TMP/badplugin"; mkdir -p "$BADPLUGIN/.claude-plugin"
echo "not json{" > "$BADPLUGIN/.claude-plugin/plugin.json"
python3 "$DOC" --plugin-root "$BADPLUGIN" --project "$PROJ4" --marketplaces "$MPDIR" >/dev/null 2>&1 \
  || fail "깨진 plugin.json 에도 fail-open(exit 0) 이어야 함"

echo "version-doctor self-test: PASS"
