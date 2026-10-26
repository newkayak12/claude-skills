// @gh-seam-1/clock - the one place elapsed time is computed. Other packages import it by relative
// path and must not keep their own copy.
// elapsed(startMs, endMs) takes two epoch-millisecond readings and returns the time between them
// in SECONDS (a number, fractions allowed).
export function elapsed(startMs, endMs) {
  return (endMs - startMs) / 1000;
}
