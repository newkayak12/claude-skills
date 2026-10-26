import { test } from "node:test";
import assert from "node:assert/strict";
import { canFulfill } from "../src/index.mjs";

test("canFulfill checks stock", () => {
  assert.equal(canFulfill("A1", 5), true);
  assert.equal(canFulfill("A1", 6), false);
  assert.equal(canFulfill("nope", 1), false);
});
