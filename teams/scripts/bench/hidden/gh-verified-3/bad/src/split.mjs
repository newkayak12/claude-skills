export function splitCents(total, weights) {
  if (!Number.isInteger(total) || total < 0) throw new RangeError("total must be a non-negative integer");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || !(sum > 0)) throw new RangeError("weights must sum to more than 0");
  const out = weights.map((w) => Math.floor((total * w) / sum));
  const left = total - out.reduce((a, b) => a + b, 0);
  out[out.length - 1] += left;
  return out;
}
