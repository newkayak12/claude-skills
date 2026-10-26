// "500ms", "2s", "3m"; a bare number is read as seconds.
export function parseDuration(text) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(text.trim());
  if (!m) throw new TypeError(`bad duration: ${text}`);
  const unit = { ms: 1, s: 1000, m: 60000 }[m[2] ?? "s"];
  return Number(m[1]) * unit;
}
