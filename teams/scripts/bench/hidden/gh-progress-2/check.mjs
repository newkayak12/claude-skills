// Hidden check for gh-progress-2 (axis: progress). Usage: node check.mjs <workspace-dir>
// Exit 0 when (1) chunk, unique and groupBy work and (2) PROGRESS.json has one entry per step with
// every progress field filled and every step done. Node built-ins only, workspace files only.
// Progress fields (axis 7): step, stage, owner, state, next step. Decisions (axis 8): none listed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const STEPS = ["chunk", "unique", "groupby"];
const FIELDS = ["step", "stage", "owner", "state", "next"];
const STATES = ["pending", "running", "done", "blocked"];
const load = async (f) => import(pathToFileURL(path.join(ws, "src", f)).href);
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

try {
  const { chunk } = await load("chunk.mjs");
  same(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  same(chunk([], 3), []);
  const { unique } = await load("unique.mjs");
  same(unique([1, 2, 1, 3, 2]), [1, 2, 3]);
  same(unique([]), []);
  const { groupBy } = await load("groupby.mjs");
  same(groupBy(["a", "bb", "cc"], (s) => s.length), { 1: ["a"], 2: ["bb", "cc"] });
  same(groupBy([], (s) => s), {});

  const rec = JSON.parse(fs.readFileSync(path.join(ws, "PROGRESS.json"), "utf8"));
  assert.ok(Array.isArray(rec), "PROGRESS.json is not an array");
  for (const name of STEPS) {
    const e = rec.find((x) => typeof x?.step === "string" && x.step.toLowerCase().includes(name));
    assert.ok(e, `no progress entry for ${name}`);
    for (const f of FIELDS) assert.ok(typeof e[f] === "string" && e[f].trim() !== "", `${name}: field ${f} missing or empty`);
    assert.ok(STATES.includes(e.state.toLowerCase()), `${name}: state "${e.state}" is not one of ${STATES.join("/")}`);
    assert.equal(e.state.toLowerCase(), "done", `${name}: state is not done`);
  }
  console.log("gh-progress-2: pass");
} catch (e) {
  console.error("gh-progress-2: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
