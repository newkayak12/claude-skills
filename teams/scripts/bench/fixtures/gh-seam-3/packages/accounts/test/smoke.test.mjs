import { test } from "node:test";
import assert from "node:assert/strict";

test("@gh-seam-3/accounts package loads", async () => {
  const m = await import("../src/index.mjs");
  assert.equal(typeof m.createUser, "function");
});
