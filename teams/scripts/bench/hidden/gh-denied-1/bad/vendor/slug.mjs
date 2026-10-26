// Vendored copy of a third-party slug helper. Pinned; changed only by re-vendoring upstream.
export function slugify(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, "-");
}
