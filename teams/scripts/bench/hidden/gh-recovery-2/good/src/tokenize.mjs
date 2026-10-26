export function tokenize(text) {
  return String(text).match(/\d+|[+\-*/()]/g) ?? [];
}
