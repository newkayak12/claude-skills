// Counts whitespace-separated words.
export function countWords(text) {
  const t = String(text).trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
