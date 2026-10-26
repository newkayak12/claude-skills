import { elapsed } from "../../clock/src/index.mjs";

// isOverdue(startMs, nowMs, limitMs) -> true when more than limitMs milliseconds have passed
export function isOverdue(startMs, nowMs, limitMs) {
  return elapsed(startMs, nowMs) > limitMs;
}
