export function splitCents(total, weights) {
  if (!Number.isInteger(total) || total < 0) throw new RangeError("total must be a non-negative integer");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || !(sum > 0)) throw new RangeError("weights must sum to more than 0");
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - out[i], i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}
