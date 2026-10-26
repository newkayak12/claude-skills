import { test } from "node:test";
import assert from "node:assert/strict";
import { elapsed } from "../src/index.mjs";

// Fixed by the fixture: this is the contract of the clock package.
test("elapsed returns seconds between two millisecond readings", () => {
  assert.equal(elapsed(1000, 3500), 2.5);
  assert.equal(elapsed(5000, 5000), 0);
});
