import { elapsed } from "../../clock/src/index.mjs";

// describe(startMs, endMs) -> "took 2.5s"
export function describe(startMs, endMs) {
  const seconds = elapsed(startMs, endMs) / 1000;
  return "took " + seconds + "s";
}
