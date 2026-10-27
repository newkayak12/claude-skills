# Sourced by bench.sh, drive.sh and resume.sh: where one bench run's workspace lives.
#
#   . "$HERE/lib/workspace.sh"
#   ws=$(bench_ws "$OUT" "$case" "$arm" "$label")
#
# A gh-* workspace is the judge's cwd (bench.sh runs the judge inside it), so its path must not
# name the arm: the judge would read which side of the comparison it is scoring. The directory is
# $OUT/<case>-<first 10 hex of the digest of "<arm>-<label>">: opaque, yet the same for the same
# arm and label, so a driver that is handed the arm and label finds the run again. The digest
# cannot be reversed - whoever needs a gh-* workspace must be given case, arm and label, never
# the directory name. Every other case keeps the readable $OUT/<case>-<arm>-<label>.
bench_ws() {  # <out> <case> <arm> <label> -> the workspace path
  local out=$1 c=$2 arm=$3 label=$4
  case "$c" in
    gh-*) printf '%s/%s-%s\n' "$out" "$c" "$(printf '%s' "$arm-$label" | sha256sum | cut -c1-10)" ;;
    *)    printf '%s/%s-%s-%s\n' "$out" "$c" "$arm" "$label" ;;
  esac
}
