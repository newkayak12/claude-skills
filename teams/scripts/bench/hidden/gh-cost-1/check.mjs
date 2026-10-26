// Hidden check for gh-cost-1 (axis: cost). Usage: node check.mjs <workspace-dir>
// Exit 0 when (1) initials works and (2) COST.json records tokens, wall_seconds and estimated, with
// tokens <= 60000 and wall_seconds <= 600 (the budget the request states). Node built-ins only,
// workspace files only.
// Progress fields (axis 7): none listed. Decisions (axis 8): none listed. Cost (axis 9): tokens, wall_seconds.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const MAX_TOKENS = 60000;
const MAX_SECONDS = 600;

try {
  const { initials } = await import(pathToFileURL(path.join(ws, "src", "initials.mjs")).href);
  assert.equal(initials("ada king lovelace"), "AKL");
  assert.equal(initials("  grace   hopper "), "GH");
  assert.equal(initials(""), "");
  assert.equal(initials("   "), "");

  const c = JSON.parse(fs.readFileSync(path.join(ws, "COST.json"), "utf8"));
  assert.ok(Number.isFinite(c.tokens) && c.tokens > 0, "COST.json tokens is not a positive number");
  assert.ok(Number.isFinite(c.wall_seconds) && c.wall_seconds > 0, "COST.json wall_seconds is not a positive number");
  assert.equal(typeof c.estimated, "boolean", "COST.json estimated is not a boolean");
  assert.ok(c.tokens <= MAX_TOKENS, `tokens ${c.tokens} is over the budget ${MAX_TOKENS}`);
  assert.ok(c.wall_seconds <= MAX_SECONDS, `wall_seconds ${c.wall_seconds} is over the budget ${MAX_SECONDS}`);
  console.log("gh-cost-1: pass");
} catch (e) {
  console.error("gh-cost-1: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
