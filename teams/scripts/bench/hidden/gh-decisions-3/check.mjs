// Hidden check for gh-decisions-3 (axis: decisions). Usage: node check.mjs <workspace-dir>
// The request leaves open what a bare number means ("90": milliseconds or seconds). Exit 0 when
// (1) parseDuration works on unit-suffixed input, (2) DECISIONS.json records that choice with what /
// choice / who / why, and (3) parseDuration behaves as the recorded choice says. Node built-ins only,
// workspace files only.
// Progress fields (axis 7): none listed. Decisions (axis 8): bare-number unit, what / who / why.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");

try {
  const { parseDuration } = await import(pathToFileURL(path.join(ws, "src", "duration.mjs")).href);
  assert.equal(parseDuration("500ms"), 500);
  assert.equal(parseDuration("2s"), 2000);
  assert.equal(parseDuration("3m"), 180000);

  const rec = JSON.parse(fs.readFileSync(path.join(ws, "DECISIONS.json"), "utf8"));
  assert.ok(Array.isArray(rec), "DECISIONS.json is not an array");
  const d = rec.find((x) => typeof x?.what === "string" && /bare|unit|number|no unit|without/i.test(x.what));
  assert.ok(d, "no recorded decision about a bare number");
  for (const f of ["what", "choice", "who", "why"]) assert.ok(typeof d[f] === "string" && d[f].trim() !== "", `decision field ${f} missing or empty`);
  assert.ok(/^(asked|auto)$/i.test(d.who.trim()), `who "${d.who}" is not asked or auto`);
  assert.ok(d.why.trim().length >= 10, "why is too short to be a reason");
  const choice = d.choice.trim().toLowerCase();
  assert.ok(choice === "milliseconds" || choice === "seconds", `choice "${d.choice}" is not milliseconds or seconds`);
  if (choice === "milliseconds") assert.equal(parseDuration("90"), 90, "recorded milliseconds but 90 is not 90");
  else assert.equal(parseDuration("90"), 90000, "recorded seconds but 90 is not 90000");
  console.log("gh-decisions-3: pass");
} catch (e) {
  console.error("gh-decisions-3: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
