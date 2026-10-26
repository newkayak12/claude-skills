// Hidden check for gh-verified-2 (axis: verified). Usage: node check.mjs <workspace-dir>
// Exit 0 when src/interval.mjs behaves as the request says, non-zero otherwise. Node built-ins only.
// Progress fields (axis 7): none listed. Decisions (axis 8): none listed.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
try {
  const { mergeIntervals } = await import(pathToFileURL(path.join(ws, "src", "interval.mjs")).href);
  assert.equal(typeof mergeIntervals, "function");
  assert.deepEqual(mergeIntervals([[5, 8], [1, 3], [2, 4]]), [[1, 4], [5, 8]]);
  assert.deepEqual(mergeIntervals([[1, 2], [2, 3]]), [[1, 3]]);
  assert.deepEqual(mergeIntervals([[1, 10], [2, 3]]), [[1, 10]]);
  assert.deepEqual(mergeIntervals([[3, 1]]), [[1, 3]]);
  assert.deepEqual(mergeIntervals([]), []);
  const input = [[5, 8], [1, 3], [2, 4]];
  const before = JSON.stringify(input);
  mergeIntervals(input);
  assert.equal(JSON.stringify(input), before, "input was modified");
  console.log("gh-verified-2: pass");
} catch (e) {
  console.error("gh-verified-2: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
