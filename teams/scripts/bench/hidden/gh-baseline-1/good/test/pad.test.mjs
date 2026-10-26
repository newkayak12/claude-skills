import { test } from "node:test";
import assert from "node:assert/strict";
import { padLeft } from "../src/pad.mjs";

test("padLeft pads on the left", () => {
  assert.equal(padLeft("7", 3, "0"), "007");
});

test("padLeft leaves a long string alone", () => {
  assert.equal(padLeft("abcd", 2), "abcd");
});
