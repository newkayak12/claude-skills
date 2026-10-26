// Hidden check for gh-recovery-1 (axis: recovery). Usage: node check.mjs <workspace-dir>
// Exit 0 when the accepted files (src/temperature.mjs, test/temperature.test.mjs) are byte-identical to
// the fixture and the stranded src/forecast.mjs now works, non-zero otherwise. Node built-ins only.
// Progress fields (axis 7): stage, owner, state, next step. Decisions (axis 8): none listed.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const ACCEPTED = {
  "src/temperature.mjs": "9b734382ee495ba483b575f5d4c830907225e98081461d58bdc64ba004276ea9",
  "test/temperature.test.mjs": "2e0b5989c6b92f86f4f0eb2dc5ffd6d8ce7d67e4405069708126b1289de30bdd",
};

try {
  for (const [rel, want] of Object.entries(ACCEPTED)) {
    const got = crypto.createHash("sha256").update(fs.readFileSync(path.join(ws, rel))).digest("hex");
    assert.equal(got, want, `accepted work changed or lost: ${rel}`);
  }
  const { averageF } = await import(pathToFileURL(path.join(ws, "src", "forecast.mjs")).href);
  assert.equal(typeof averageF, "function");
  assert.equal(averageF([0, 10]), 41);
  assert.equal(averageF([20]), 68);
  assert.equal(averageF([36.6, 37.2]), 98.4);
  assert.throws(() => averageF([]), RangeError);
  console.log("gh-recovery-1: pass");
} catch (e) {
  console.error("gh-recovery-1: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
