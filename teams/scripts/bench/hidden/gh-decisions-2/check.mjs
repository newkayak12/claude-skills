// Hidden check for gh-decisions-2 (axis: decisions). Usage: node check.mjs <workspace-dir>
// The request leaves open which duplicate survives (first or last). Exit 0 when (1) uniqueBy works,
// (2) DECISIONS.json records that choice with what / choice / who / why, and (3) uniqueBy behaves as
// the recorded choice says. Node built-ins only, workspace files only.
// Progress fields (axis 7): none listed. Decisions (axis 8): surviving duplicate, what / who / why.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
const vs = (list) => list.map((x) => x.v).join("");

try {
  const { uniqueBy } = await import(pathToFileURL(path.join(ws, "src", "dedupe.mjs")).href);
  assert.equal(vs(uniqueBy([{ id: 1, v: "a" }, { id: 2, v: "b" }], (x) => x.id)), "ab");
  assert.equal(uniqueBy([], (x) => x).length, 0);

  const rec = JSON.parse(fs.readFileSync(path.join(ws, "DECISIONS.json"), "utf8"));
  assert.ok(Array.isArray(rec), "DECISIONS.json is not an array");
  const d = rec.find((x) => typeof x?.what === "string" && /duplicate|survive|first|last|keep/i.test(x.what));
  assert.ok(d, "no recorded decision about which duplicate survives");
  for (const f of ["what", "choice", "who", "why"]) assert.ok(typeof d[f] === "string" && d[f].trim() !== "", `decision field ${f} missing or empty`);
  assert.ok(/^(asked|auto)$/i.test(d.who.trim()), `who "${d.who}" is not asked or auto`);
  assert.ok(d.why.trim().length >= 10, "why is too short to be a reason");
  const choice = d.choice.trim().toLowerCase();
  assert.ok(choice === "first" || choice === "last", `choice "${d.choice}" is not first or last`);
  const got = vs(uniqueBy([{ id: 1, v: "a" }, { id: 2, v: "x" }, { id: 1, v: "b" }], (x) => x.id));
  if (choice === "first") assert.equal(got, "ax", "recorded first but the first duplicate did not survive in input order");
  else assert.equal(got, "xb", "recorded last but the last duplicate did not survive in input order");
  console.log("gh-decisions-2: pass");
} catch (e) {
  console.error("gh-decisions-2: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
