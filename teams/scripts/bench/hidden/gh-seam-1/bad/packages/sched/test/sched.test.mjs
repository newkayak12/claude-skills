import { test } from "node:test";
import assert from "node:assert/strict";
import { isOverdue } from "../src/index.mjs";

test("isOverdue is false for a short gap", () => {
  assert.equal(isOverdue(1000, 2500, 2000), false);
});
