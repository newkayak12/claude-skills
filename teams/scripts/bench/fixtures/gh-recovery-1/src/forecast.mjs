import { cToF } from "./temperature.mjs";

// interrupted run: averageF was started and never finished
export function averageF(readingsC) {
  const total = readingsC.reduce(
