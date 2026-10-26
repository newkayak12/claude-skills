import { test } from "node:test";
import assert from "node:assert/strict";

test("@gh-seam-3/audit package loads", async () => {
  const m = await import("../src/index.mjs");
  assert.equal(typeof m.startAudit, "function");
});
