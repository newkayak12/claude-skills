import test from "node:test";
import assert from "node:assert/strict";
import { cToF, fToC } from "../src/temperature.mjs";

test("freezing and boiling", () => {
  assert.equal(cToF(0), 32);
  assert.equal(cToF(100), 212);
  assert.equal(fToC(32), 0);
  assert.equal(fToC(212), 100);
});
