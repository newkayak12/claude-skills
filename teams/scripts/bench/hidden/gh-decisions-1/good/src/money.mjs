// Rounds to two decimals; an exact tie goes to the even cent (half to even).
export function roundCents(amount) {
  const s = amount * 100;
  const f = Math.floor(s);
  const r = s - f === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(s);
  return r / 100;
}
