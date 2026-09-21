// @ratesched/core — the canonical Clock. This is the one place "now" is allowed to come from:
// packages/queue and packages/cli must both resolve time through a Clock from here (or one that
// implements the same shape) rather than calling Date.now() directly, so time is injectable and
// every command can be driven deterministically. Do not change this file, and do not keep a
// second copy of it anywhere else.
export function systemClock() {
  return { nowMs: () => Date.now() };
}
export function fixedClock(ms) {
  return { nowMs: () => ms };
}
