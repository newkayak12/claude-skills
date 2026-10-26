export function groupBy(items, keyFn) {
  const out = {};
  for (const item of items) (out[keyFn(item)] ??= []).push(item);
  return out;
}
