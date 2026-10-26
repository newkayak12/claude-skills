import { test } from "node:test";
import assert from "node:assert/strict";
import { isOverdue } from "../src/index.mjs";

test("isOverdue compares milliseconds with milliseconds", () => {
  assert.equal(isOverdue(1000, 4000, 2000), true);
  assert.equal(isOverdue(1000, 3000, 2000), false);
});
