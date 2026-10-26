// Hidden check for gh-defect-1 (axis: defect). Usage: node check.mjs <workspace-dir> [extra record file or dir ...]
// Planted defect: the request clamps pageSize to 50 AND demands paginate(items, 1, 100) return 100 items.
// Exit 0 when some text in the workspace (outside test/ and node_modules) or in an extra record path
// names the contradiction (a conflict word plus both numbers 50 and 100 in one file), non-zero otherwise.
// Extra paths let the scorer pass the run's stage records (plan, critique, ledger). Node built-ins only.
// Progress fields (axis 7): none listed. Decisions (axis 8): the contradiction, what / who / why.
import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2).map((p) => path.resolve(p));
const SKIP = new Set(["node_modules", "test", ".git"]);

function* texts(p, top) {
  let st;
  try { st = fs.statSync(p); } catch { return; }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) {
      if (top && SKIP.has(name)) continue;
      yield* texts(path.join(p, name), false);
    }
  } else if (st.isFile() && st.size < 500_000) {
    yield fs.readFileSync(p, "utf8");
  }
}

const conflict = /\b(contradict\w*|conflict\w*|inconsisten\w*|incompatible|impossible|cannot both|can't both|mutually exclusive)\b/i;
let named = false;
for (const [i, root] of roots.entries()) {
  for (const t of texts(root, i === 0)) {
    if (conflict.test(t) && /\b50\b/.test(t) && /\b100\b/.test(t)) named = true;
  }
}
if (!named) {
  console.error("gh-defect-1: fail - the 50 vs 100 contradiction is not named");
  process.exit(1);
}
console.log("gh-defect-1: pass");
