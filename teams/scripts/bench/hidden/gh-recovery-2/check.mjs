// Hidden check for gh-recovery-2 (axis: recovery). Usage: node check.mjs <workspace-dir>
// Exit 0 when the accepted files (src/tokenize.mjs, test/tokenize.test.mjs) are byte-identical to the
// fixture, the stranded leftovers (src/calc.mjs.partial, .run.lock) are gone, and src/calc.mjs works,
// non-zero otherwise. Node built-ins only.
// Progress fields (axis 7): stage, owner, state, next step. Decisions (axis 8): leftovers removed, what / why.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const ACCEPTED = {
  "src/tokenize.mjs": "9278417f27567b785aa56c60a6613c23c7de9164489af90ffd34f4fa0e3d7deb",
  "test/tokenize.test.mjs": "7d8446c0402099df557156d77fffd605d926600a8b9c3d260b93be4a1cf74554",
};
const STRANDED = ["src/calc.mjs.partial", ".run.lock"];

try {
  for (const [rel, want] of Object.entries(ACCEPTED)) {
    const got = crypto.createHash("sha256").update(fs.readFileSync(path.join(ws, rel))).digest("hex");
    assert.equal(got, want, `accepted work changed or lost: ${rel}`);
  }
  for (const rel of STRANDED) {
    assert.equal(fs.existsSync(path.join(ws, rel)), false, `stranded leftover still present: ${rel}`);
  }
  const { evaluate } = await import(pathToFileURL(path.join(ws, "src", "calc.mjs")).href);
  assert.equal(typeof evaluate, "function");
  assert.equal(evaluate("1+2*3"), 7);
  assert.equal(evaluate("(1+2)*3"), 9);
  assert.equal(evaluate("10/4"), 2.5);
  assert.equal(evaluate("2*(3+4)-5"), 9);
  assert.equal(evaluate(" 8 / 2 / 2"), 2);
  assert.throws(() => evaluate(""), SyntaxError);
  assert.throws(() => evaluate("2+"), SyntaxError);
  assert.throws(() => evaluate("(1+2"), SyntaxError);
  assert.throws(() => evaluate("1 2"), SyntaxError);
  console.log("gh-recovery-2: pass");
} catch (e) {
  console.error("gh-recovery-2: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
