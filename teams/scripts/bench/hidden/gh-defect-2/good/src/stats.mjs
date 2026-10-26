// Arithmetic mean of a list of numbers; 0 for an empty list.
export function mean(xs) {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
