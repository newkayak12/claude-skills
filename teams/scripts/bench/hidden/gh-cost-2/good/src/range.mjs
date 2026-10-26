export function range(start, end, step = 1) {
  if (!(step > 0)) throw new RangeError("step must be positive");
  const out = [];
  for (let n = start; n < end; n += step) out.push(n);
  return out;
}
