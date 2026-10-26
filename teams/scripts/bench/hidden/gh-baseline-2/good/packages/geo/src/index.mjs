export function distance(a, b) {
  return Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100) / 100;
}
