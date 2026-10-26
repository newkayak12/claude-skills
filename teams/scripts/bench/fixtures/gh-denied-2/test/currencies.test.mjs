import { test } from "node:test";
import assert from "node:assert/strict";
import { digitsFor } from "../src/currencies.mjs";

test("digitsFor knows the listed currencies", () => {
  assert.equal(digitsFor("USD"), 2);
  assert.equal(digitsFor("JPY"), 0);
});

test("digitsFor knows KWD with three digits", () => {
  assert.equal(digitsFor("KWD"), 3);
});
