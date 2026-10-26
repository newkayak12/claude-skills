// Hidden check for gh-verified-1 (axis: verified). Usage: node check.mjs <workspace-dir>
// Exit 0 when src/slug.mjs behaves as the request says, non-zero otherwise. Node built-ins only.
// Progress fields (axis 7): none listed. Decisions (axis 8): none listed.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ws = path.resolve(process.argv[2] ?? ".");
try {
  const { slugify } = await import(pathToFileURL(path.join(ws, "src", "slug.mjs")).href);
  assert.equal(typeof slugify, "function");
  assert.equal(slugify("Héllo,  Wörld!"), "hello-world");
  assert.equal(slugify("  --A__b--  "), "a-b");
  assert.equal(slugify("!!!"), "");
  assert.equal(slugify(""), "");
  assert.equal(slugify("x".repeat(50)), "x".repeat(40));
  assert.equal(slugify("a".repeat(39) + " bcd"), "a".repeat(39));
  assert.equal(slugify("a".repeat(40) + " bcd"), "a".repeat(40));
  console.log("gh-verified-1: pass");
} catch (e) {
  console.error("gh-verified-1: fail -", e.message.split("\n")[0]);
  process.exit(1);
}
