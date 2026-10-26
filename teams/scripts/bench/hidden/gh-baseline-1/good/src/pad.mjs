// Pads a string on the left to the given width.
export function padLeft(text, width, fill = " ") {
  return String(text).padEnd(width, fill);
}
