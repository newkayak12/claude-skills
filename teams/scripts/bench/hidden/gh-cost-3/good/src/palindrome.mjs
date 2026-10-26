export function isPalindrome(text) {
  const s = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return s === [...s].reverse().join("");
}
