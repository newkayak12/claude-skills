// Splits one comma-separated line into trimmed cells.
export function parseRow(line) {
  return String(line).split(",").map((cell) => cell.trim());
}
