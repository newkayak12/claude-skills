export function wordCount(text) {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}
