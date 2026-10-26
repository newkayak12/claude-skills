import { elapsed } from "../../clock/src/index.mjs";

// describe(startMs, endMs) -> "took 2.5s"
export function describe(startMs, endMs) {
  return "took " + elapsed(startMs, endMs) + "s";
}
