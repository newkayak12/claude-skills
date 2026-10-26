// Hidden check for gh-verified-3 (axis: verified). Usage: node check.mjs <workspace-dir>
// Exit 0 when src/split.mjs behaves as the request says, non-zero otherwise. Node built-ins only.
// Progress fields (axis 7): none listed. Decisions (axis 8): none listed.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
try {
  const { splitCents } = await import(pathToFileURL(path.join(ws, "src", "split.mjs")).href);
  assert.equal(typeof splitCents, "function");
  assert.deepEqual(splitCents(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(splitCents(10, [1, 1]), [5, 5]);
  assert.deepEqual(splitCents(5, [0, 1, 1]), [0, 3, 2]);
  assert.deepEqual(splitCents(0, [1, 2]), [0, 0]);
  const parts = splitCents(1000, [3, 5, 7, 11, 13]);
  assert.equal(parts.length, 5);
  assert.ok(parts.every(Number.isInteger));
  assert.equal(parts.reduce((a, b) => a + b, 0), 1000);
  assert.throws(() => splitCents(10, [0, 0]), RangeError);
  assert.throws(() => splitCents(10, []), RangeError);
  assert.throws(() => splitCents(1.5, [1]), RangeError);
  assert.throws(() => splitCents(-1, [1]), RangeError);
  console.log("gh-verified-3: pass");
} catch (e) {
  console.error("gh-verified-3: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
