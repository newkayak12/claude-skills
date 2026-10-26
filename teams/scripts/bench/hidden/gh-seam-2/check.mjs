// Hidden check for gh-seam-2 (axis: seam). Usage: node check.mjs <workspace-dir>
// Seam: packages/inventory returns { sku, qty }; packages/orders read { id, quantity } and
// packages/export read { code, count }. Exit 0 when the inventory package is untouched, both consumers
// agree with its record shape, no consumer keeps its own copy of the stock data, and each has a real test.
// Node built-ins only. Progress fields (axis 7): stage, owner, state, next step.
// Decisions (axis 8): which side of the seam changes, what / who / why.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const CANONICAL = {
  "packages/inventory/src/index.mjs": "0cd256aa2dd030b759e23730d44f8677404a3fc239ea3ec451de1db78975cd52",
  "packages/inventory/test/inventory.test.mjs": "82f226891260f71ad92a901a869735fd2540217c9c10a0c3d9765b4ef95d7c5c",
};

function* sources(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "test") continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(mjs|js|cjs)$/.test(name)) yield p;
  }
}

const load = (rel) => import(pathToFileURL(path.join(ws, rel)).href);
const testText = (pkg) =>
  fs.readdirSync(path.join(ws, "packages", pkg, "test"))
    .filter((f) => /\.test\.mjs$/.test(f))
    .map((f) => fs.readFileSync(path.join(ws, "packages", pkg, "test", f), "utf8"))
    .join("\n");

try {
  for (const [rel, want] of Object.entries(CANONICAL)) {
    const got = crypto.createHash("sha256").update(fs.readFileSync(path.join(ws, rel))).digest("hex");
    assert.equal(got, want, `canonical inventory file changed: ${rel}`);
  }
  const { canFulfill } = await load("packages/orders/src/index.mjs");
  assert.equal(canFulfill("A1", 3), true);
  assert.equal(canFulfill("A1", 5), true);
  assert.equal(canFulfill("A1", 6), false);
  assert.equal(canFulfill("B2", 1), false);
  assert.equal(canFulfill("C3", 12), true);
  assert.equal(canFulfill("ZZ", 1), false);
  const { toCsv } = await load("packages/export/src/index.mjs");
  assert.equal(toCsv(), "sku,qty\nA1,5\nB2,0\nC3,12\n");
  for (const f of sources(path.join(ws, "packages"))) {
    if (f.startsWith(path.join(ws, "packages", "inventory") + path.sep)) continue;
    const text = fs.readFileSync(f, "utf8");
    assert.ok(!/["'](A1|B2|C3)["']/.test(text), `stock data copied outside inventory: ${path.relative(ws, f)}`);
  }
  assert.ok(/canFulfill\s*\(/.test(testText("orders")), "packages/orders has no test of canFulfill");
  assert.ok(/toCsv\s*\(/.test(testText("export")), "packages/export has no test of toCsv");
  console.log("gh-seam-2: pass");
} catch (e) {
  console.error("gh-seam-2: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
