import { tokenize } from "./tokenize.mjs";

export function evaluate(expr) {
  const t = tokenize(expr);
  let i = 0;
  const peek = () => t[i];

  function primary() {
    const x = t[i++];
    if (x === undefined) throw new SyntaxError("unexpected end");
    if (x === "(") {
      const v = sum();
      if (t[i++] !== ")") throw new SyntaxError("missing )");
      return v;
    }
    if (/^\d+$/.test(x)) return Number(x);
    throw new SyntaxError(`unexpected ${x}`);
  }

  function product() {
    let v = primary();
    while (peek() === "*" || peek() === "/") {
      const op = t[i++];
      const r = primary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }

  function sum() {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = t[i++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const v = sum();
  if (i < t.length) throw new SyntaxError(`trailing ${t[i]}`);
  return v;
}
