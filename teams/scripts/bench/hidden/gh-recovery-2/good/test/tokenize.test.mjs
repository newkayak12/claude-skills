import test from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/tokenize.mjs";

test("splits numbers and operators", () => {
  assert.deepEqual(tokenize("12 + (3*4)"), ["12", "+", "(", "3", "*", "4", ")"]);
});

test("empty text gives no tokens", () => {
  assert.deepEqual(tokenize(""), []);
});
