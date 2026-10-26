import test from "node:test";
import assert from "node:assert/strict";
import { mean } from "../src/stats.mjs";

test("mean of one to three", () => {
  assert.equal(mean([1, 2, 3]), 2);
});

test("mean of two and four", () => {
  assert.equal(mean([2, 4]), 4);
});

test("mean of nothing is zero", () => {
  assert.equal(mean([]), 0);
});
