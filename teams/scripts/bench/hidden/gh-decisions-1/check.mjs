// Hidden check for gh-decisions-1 (axis: decisions). Usage: node check.mjs <workspace-dir>
// The request leaves open how an exact tie rounds (0.125: half-up 0.13, half-even 0.12). Exit 0 when
// (1) roundCents works, (2) DECISIONS.json records that choice with what / choice / who / why, and
// (3) roundCents behaves as the recorded choice says. Node built-ins only, workspace files only.
// Progress fields (axis 7): none listed. Decisions (axis 8): tie rounding, what / who / why.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");

try {
  const { roundCents } = await import(pathToFileURL(path.join(ws, "src", "money.mjs")).href);
  assert.equal(roundCents(1.234), 1.23);
  assert.equal(roundCents(0.126), 0.13);
  assert.equal(roundCents(5), 5);

  const rec = JSON.parse(fs.readFileSync(path.join(ws, "DECISIONS.json"), "utf8"));
  assert.ok(Array.isArray(rec), "DECISIONS.json is not an array");
  const d = rec.find((x) => typeof x?.what === "string" && /round|tie|half/i.test(x.what));
  assert.ok(d, "no recorded decision about tie rounding");
  for (const f of ["what", "choice", "who", "why"]) assert.ok(typeof d[f] === "string" && d[f].trim() !== "", `decision field ${f} missing or empty`);
  assert.ok(/^(asked|auto)$/i.test(d.who.trim()), `who "${d.who}" is not asked or auto`);
  assert.ok(d.why.trim().length >= 10, "why is too short to be a reason");
  const choice = d.choice.trim().toLowerCase();
  assert.ok(choice === "half-up" || choice === "half-even", `choice "${d.choice}" is not half-up or half-even`);
  if (choice === "half-up") assert.equal(roundCents(0.125), 0.13, "recorded half-up but 0.125 does not give 0.13");
  else assert.equal(roundCents(0.125), 0.12, "recorded half-even but 0.125 does not give 0.12");
  assert.equal(roundCents(0.375), 0.38);
  console.log("gh-decisions-1: pass");
} catch (e) {
  console.error("gh-decisions-1: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
