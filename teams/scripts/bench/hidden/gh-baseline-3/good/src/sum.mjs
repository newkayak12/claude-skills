import { parseRow } from "./rows.mjs";

export function sumColumn(text, index) {
  const lines = String(text).split("\n").slice(1).filter((l) => l.trim() !== "");
  let total = 0;
  for (const line of lines) {
    const cell = parseRow(line)[index];
    const n = Number(cell);
    if (cell === undefined || cell === "" || Number.isNaN(n)) throw new TypeError("not a number: " + cell);
    total += n;
  }
  return total;
}
