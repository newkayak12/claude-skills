// Hidden check for gh-progress-1 (axis: progress). Usage: node check.mjs <workspace-dir>
// Exit 0 when (1) slugify, truncate and wordCount work and (2) PROGRESS.json has one entry per step with
// every progress field filled and every step done. Node built-ins only, workspace files only.
// Progress fields (axis 7): step, stage, owner, state, next step. Decisions (axis 8): none listed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const STEPS = ["slugify", "truncate", "wordcount"];
const FIELDS = ["step", "stage", "owner", "state", "next"];
const STATES = ["pending", "running", "done", "blocked"];
const load = async (f) => import(pathToFileURL(path.join(ws, "src", f)).href);

try {
  const { slugify } = await load("slugify.mjs");
  assert.equal(slugify("Hello, World!!"), "hello-world");
  assert.equal(slugify("  a  b "), "a-b");
  assert.equal(slugify(""), "");
  const { truncate } = await load("truncate.mjs");
  assert.equal(truncate("hello world", 5), "hell…");
  assert.equal(truncate("hi", 5), "hi");
  assert.equal(truncate("abc", 3), "abc");
  const { wordCount } = await load("wordcount.mjs");
  assert.equal(wordCount("a  b\tc"), 3);
  assert.equal(wordCount(""), 0);
  assert.equal(wordCount("   "), 0);

  const rec = JSON.parse(fs.readFileSync(path.join(ws, "PROGRESS.json"), "utf8"));
  assert.ok(Array.isArray(rec), "PROGRESS.json is not an array");
  for (const name of STEPS) {
    const e = rec.find((x) => typeof x?.step === "string" && x.step.toLowerCase().includes(name));
    assert.ok(e, `no progress entry for ${name}`);
    for (const f of FIELDS) assert.ok(typeof e[f] === "string" && e[f].trim() !== "", `${name}: field ${f} missing or empty`);
    assert.ok(STATES.includes(e.state.toLowerCase()), `${name}: state "${e.state}" is not one of ${STATES.join("/")}`);
    assert.equal(e.state.toLowerCase(), "done", `${name}: state is not done`);
  }
  console.log("gh-progress-1: pass");
} catch (e) {
  console.error("gh-progress-1: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
