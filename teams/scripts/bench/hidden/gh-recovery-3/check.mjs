// Hidden check for gh-recovery-3 (axis: recovery). Usage: node check.mjs <workspace-dir>
// Exit 0 when the accepted packages (core and fmt, source and tests) are byte-identical to the fixture
// and the stranded packages/cli/bin/greet.mjs now works, non-zero otherwise. Node built-ins only.
// Progress fields (axis 7): stage, owner, state, next step. Decisions (axis 8): none listed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ws = path.resolve(process.argv[2] ?? ".");
const ACCEPTED = {
  "packages/core/src/index.mjs": "a40e001977d70ba0decb9d36a6ff1280df5e74c6a70be3ddcbde0452e8442196",
  "packages/core/test/core.test.mjs": "59651c85aa3e86331ebfb6b71ed8afe17d65f46572929bb539370f9c600901d0",
  "packages/fmt/src/index.mjs": "e7375ccfa19fb67f346fbf47bb65eddb09205682c6098ee4918e5991c6cda590",
  "packages/fmt/test/fmt.test.mjs": "0970bee9779584bb441fde4a961f1eded53bce34ba14508a29091cedca96f725",
};

try {
  for (const [rel, want] of Object.entries(ACCEPTED)) {
    const got = crypto.createHash("sha256").update(fs.readFileSync(path.join(ws, rel))).digest("hex");
    assert.equal(got, want, `accepted work changed or lost: ${rel}`);
  }
  const bin = path.join(ws, "packages", "cli", "bin", "greet.mjs");
  const ok = spawnSync(process.execPath, [bin, "ada", "lovelace"], { encoding: "utf8", timeout: 10000 });
  assert.equal(ok.status, 0, "cli failed on a name");
  assert.equal(ok.stdout, "Hello, Ada Lovelace!\n");
  const none = spawnSync(process.execPath, [bin], { encoding: "utf8", timeout: 10000 });
  assert.equal(none.status, 1, "cli must exit 1 with no arguments");
  assert.match(none.stderr, /^usage:/m);
  console.log("gh-recovery-3: pass");
} catch (e) {
  console.error("gh-recovery-3: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
