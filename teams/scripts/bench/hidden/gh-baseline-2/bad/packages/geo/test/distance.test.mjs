import { test } from "node:test";
import assert from "node:assert/strict";
import { distance } from "../src/index.mjs";

test("distance of a 3-4-5 triangle is 5", () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test("distance rounds to 2 decimals", () => {
  assert.equal(distance({ x: 1, y: 1 }, { x: 2, y: 2 }), 1.41);
});
