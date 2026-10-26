// Hidden check for gh-seam-3 (axis: seam). Usage: node check.mjs <workspace-dir>
// Seam: packages/accounts publishes "USER_CREATED"/"USER_DELETED" while packages/audit listens on
// "user-created"/"user-deleted"; the canonical names are in packages/topics. Exit 0 when topics and bus
// are untouched, a create/delete pair reaches the audit log under the canonical names, no package outside
// topics spells a canonical topic string out (one definition), and each package has a real test.
// Node built-ins only. Progress fields (axis 7): stage, owner, state, next step.
// Decisions (axis 8): which side of the seam changes, what / who / why.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const CANONICAL = {
  "packages/topics/src/index.mjs": "d7099a891e7a8a31b86b40bb3d481486337aaa54ee4e0ab6354830063817c276",
  "packages/topics/test/topics.test.mjs": "b1ba02345ddfda8e880ca062898e71fb736c63c014ff9d6a5ca876fe800b1797",
  "packages/bus/src/index.mjs": "969ef26196741cfbdf5fc42e6fd242f8a3830221bd811d3aae38b00062696048",
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
    assert.equal(got, want, `canonical file changed: ${rel}`);
  }
  const bus = await load("packages/bus/src/index.mjs");
  const { createUser, deleteUser } = await load("packages/accounts/src/index.mjs");
  const { startAudit, entries } = await load("packages/audit/src/index.mjs");
  bus.reset();
  startAudit();
  createUser("ann");
  deleteUser("ann");
  assert.deepEqual(entries(), ["user.created:ann", "user.deleted:ann"]);
  startAudit();
  assert.deepEqual(entries(), [], "startAudit does not clear the log");
  for (const f of sources(path.join(ws, "packages"))) {
    if (f.startsWith(path.join(ws, "packages", "topics") + path.sep)) continue;
    const text = fs.readFileSync(f, "utf8");
    assert.ok(!/["'`]user\.(created|deleted)["'`]/.test(text), `topic string spelled out outside topics: ${path.relative(ws, f)}`);
  }
  assert.ok(/createUser\s*\(/.test(testText("accounts")), "packages/accounts has no test of createUser");
  assert.ok(/startAudit\s*\(/.test(testText("audit")), "packages/audit has no test of startAudit");
  console.log("gh-seam-3: pass");
} catch (e) {
  console.error("gh-seam-3: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
