// Removes duplicates by key; the last item with a key survives, survivors keep input order.
export function uniqueBy(items, keyFn) {
  const last = new Map();
  items.forEach((item, i) => last.set(keyFn(item), i));
  return items.filter((item, i) => last.get(keyFn(item)) === i);
}
