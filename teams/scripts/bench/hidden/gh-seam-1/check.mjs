// Hidden check for gh-seam-1 (axis: seam). Usage: node check.mjs <workspace-dir>
// Seam: packages/clock returns elapsed SECONDS, packages/report and packages/sched each assumed otherwise.
// Exit 0 when the canonical clock package is untouched, both consumers agree with its contract (so the
// seam is settled once, not per caller), no second `elapsed` exists, and each consumer has a real test.
// Node built-ins only. Progress fields (axis 7): stage, owner, state, next step.
// Decisions (axis 8): which side of the seam changes, what / who / why.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const CANONICAL = {
  "packages/clock/src/index.mjs": "9046f993135b3093a72ed3cb0ec3f5d18fa893e9f138fa84f97ffa4d713e6208",
  "packages/clock/test/clock.test.mjs": "57adffc2ea2e747207cf5ca46f4305ddf44e4ef009c7b5f0ca312710e0f303ce",
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
    assert.equal(got, want, `canonical clock file changed: ${rel}`);
  }
  const { describe } = await load("packages/report/src/index.mjs");
  assert.equal(describe(1000, 3500), "took 2.5s");
  assert.equal(describe(0, 1000), "took 1s");
  const { isOverdue } = await load("packages/sched/src/index.mjs");
  assert.equal(isOverdue(1000, 4000, 2000), true);
  assert.equal(isOverdue(1000, 2500, 2000), false);
  assert.equal(isOverdue(1000, 3000, 2000), false);
  for (const f of sources(path.join(ws, "packages"))) {
    if (f.startsWith(path.join(ws, "packages", "clock") + path.sep)) continue;
    const text = fs.readFileSync(f, "utf8");
    assert.ok(!/function\s+elapsed\b|\b(const|let|var)\s+elapsed\s*=/.test(text), `second copy of elapsed: ${path.relative(ws, f)}`);
  }
  assert.ok(/took /.test(testText("report")), "packages/report has no test of describe");
  assert.ok(/isOverdue\s*\(/.test(testText("sched")), "packages/sched has no test of isOverdue");
  console.log("gh-seam-1: pass");
} catch (e) {
  console.error("gh-seam-1: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
