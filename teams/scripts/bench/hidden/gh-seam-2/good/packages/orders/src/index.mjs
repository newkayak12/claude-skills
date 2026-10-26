import { listItems } from "../../inventory/src/index.mjs";

// canFulfill(sku, n) -> true when stock holds at least n units of sku
export function canFulfill(sku, n) {
  const item = listItems().find((i) => i.sku === sku);
  return item !== undefined && item.qty >= n;
}
