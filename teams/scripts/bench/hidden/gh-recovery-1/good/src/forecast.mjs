import { cToF } from "./temperature.mjs";

export function averageF(readingsC) {
  if (readingsC.length === 0) throw new RangeError("no readings");
  const meanC = readingsC.reduce((a, b) => a + b, 0) / readingsC.length;
  return Math.round(cToF(meanC) * 10) / 10;
}
