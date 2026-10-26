export function initials(name) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("");
}
