export function mean(list) {
  return list.length === 0 ? null : list.reduce((a, b) => a + b, 0) / list.length;
}
