// toCsv() -> "sku,qty\nA1,5\n..." one line per item, header first, trailing newline
const COPY = [
  { sku: "A1", qty: 5 },
  { sku: "B2", qty: 0 },
  { sku: "C3", qty: 12 },
];

export function toCsv() {
  const lines = COPY.map((i) => i.sku + "," + i.qty);
  return ["sku,qty", ...lines].join("\n") + "\n";
}
