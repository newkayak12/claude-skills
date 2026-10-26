// Hidden check for gh-progress-3 (axis: progress). Usage: node check.mjs <workspace-dir>
// Exit 0 when (1) clamp, sum and mean work and (2) PROGRESS.json has one entry per step with
// every progress field filled and every step done. Node built-ins only, workspace files only.
// Progress fields (axis 7): step, stage, owner, state, next step. Decisions (axis 8): none listed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const STEPS = ["clamp", "sum", "mean"];
const FIELDS = ["step", "stage", "owner", "state", "next"];
const STATES = ["pending", "running", "done", "blocked"];
const load = async (f) => import(pathToFileURL(path.join(ws, "src", f)).href);

try {
  const { clamp } = await load("clamp.mjs");
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
  const { sum } = await load("sum.mjs");
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sum([]), 0);
  const { mean } = await load("mean.mjs");
  assert.equal(mean([2, 4]), 3);
  assert.equal(mean([]), null);

  const rec = JSON.parse(fs.readFileSync(path.join(ws, "PROGRESS.json"), "utf8"));
  assert.ok(Array.isArray(rec), "PROGRESS.json is not an array");
  for (const name of STEPS) {
    const e = rec.find((x) => typeof x?.step === "string" && x.step.toLowerCase().includes(name));
    assert.ok(e, `no progress entry for ${name}`);
    for (const f of FIELDS) assert.ok(typeof e[f] === "string" && e[f].trim() !== "", `${name}: field ${f} missing or empty`);
    assert.ok(STATES.includes(e.state.toLowerCase()), `${name}: state "${e.state}" is not one of ${STATES.join("/")}`);
    assert.equal(e.state.toLowerCase(), "done", `${name}: state is not done`);
  }
  console.log("gh-progress-3: pass");
} catch (e) {
  console.error("gh-progress-3: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
