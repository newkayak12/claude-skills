// @gh-seam-2/inventory - the one source of stock data. Other packages import it by relative path.
// listItems() returns an array of { sku: string, qty: number }.
const ITEMS = [
  { sku: "A1", qty: 5 },
  { sku: "B2", qty: 0 },
  { sku: "C3", qty: 12 },
];

export function listItems() {
  return ITEMS.map((item) => ({ ...item }));
}
