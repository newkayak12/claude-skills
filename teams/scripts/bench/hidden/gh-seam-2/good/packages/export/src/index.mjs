import { listItems } from "../../inventory/src/index.mjs";

// toCsv() -> "sku,qty\nA1,5\n..." one line per item, header first, trailing newline
export function toCsv() {
  const lines = listItems().map((i) => i.sku + "," + i.qty);
  return ["sku,qty", ...lines].join("\n") + "\n";
}
