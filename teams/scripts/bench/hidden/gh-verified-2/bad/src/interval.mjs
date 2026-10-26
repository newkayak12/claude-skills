export function mergeIntervals(list) {
  const sorted = list
    .map(([a, b]) => (a <= b ? [a, b] : [b, a]))
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = iv[1];
    else out.push(iv);
  }
  return out;
}
