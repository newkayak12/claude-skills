// Hidden check for gh-cost-2 (axis: cost). Usage: node check.mjs <workspace-dir>
// Exit 0 when (1) range works and (2) COST.json records tokens, wall_seconds and estimated, with
// tokens <= 50000 and wall_seconds <= 480 (the budget the request states). Node built-ins only,
// workspace files only.
// Progress fields (axis 7): none listed. Decisions (axis 8): none listed. Cost (axis 9): tokens, wall_seconds.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const MAX_TOKENS = 50000;
const MAX_SECONDS = 480;

try {
  const { range } = await import(pathToFileURL(path.join(ws, "src", "range.mjs")).href);
  assert.equal(JSON.stringify(range(0, 5)), "[0,1,2,3,4]");
  assert.equal(JSON.stringify(range(0, 10, 3)), "[0,3,6,9]");
  assert.equal(JSON.stringify(range(3, 3)), "[]");
  assert.throws(() => range(0, 5, 0), RangeError);
  assert.throws(() => range(0, 5, -1), RangeError);

  const c = JSON.parse(fs.readFileSync(path.join(ws, "COST.json"), "utf8"));
  assert.ok(Number.isFinite(c.tokens) && c.tokens > 0, "COST.json tokens is not a positive number");
  assert.ok(Number.isFinite(c.wall_seconds) && c.wall_seconds > 0, "COST.json wall_seconds is not a positive number");
  assert.equal(typeof c.estimated, "boolean", "COST.json estimated is not a boolean");
  assert.ok(c.tokens <= MAX_TOKENS, `tokens ${c.tokens} is over the budget ${MAX_TOKENS}`);
  assert.ok(c.wall_seconds <= MAX_SECONDS, `wall_seconds ${c.wall_seconds} is over the budget ${MAX_SECONDS}`);
  console.log("gh-cost-2: pass");
} catch (e) {
  console.error("gh-cost-2: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
