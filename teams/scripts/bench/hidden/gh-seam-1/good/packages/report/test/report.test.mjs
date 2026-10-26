import { test } from "node:test";
import assert from "node:assert/strict";
import { describe } from "../src/index.mjs";

test("describe reports seconds", () => {
  assert.equal(describe(1000, 3500), "took 2.5s");
});
