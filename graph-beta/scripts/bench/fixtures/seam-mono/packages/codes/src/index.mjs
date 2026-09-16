// @lintcfg/codes — the canonical exit-code table for lintcfg. This is the one place these
// numbers are defined: packages/parser names a failure by one of these keys, packages/cli
// looks the key up here to decide the process exit code. Do not change the numbers here, and
// do not keep a second copy of them anywhere else — a second copy is exactly the defect this
// fixture exists to catch.
export const EXIT_CODES = Object.freeze({
  OK: 0,
  PARSE_ERROR: 2,
  MISSING_FIELD: 3,
  BAD_TYPE: 4,
  UNKNOWN_FIELD: 5,
});
