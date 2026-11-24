// One digest line for a list of bus records. Pure: same input, same output.
// Reads only ts, from and to. Empty input gives 'bus: 0 msg'.
export function busDigest(messages) {
  if (messages.length === 0) return 'bus: 0 msg';
  let latest = messages[0];
  for (const m of messages) {
    if (Number(m.ts) >= Number(latest.ts)) latest = m;
  }
  return `bus: ${messages.length} msg, last ${latest.from} -> ${latest.to} @ ${latest.ts}`;
}
