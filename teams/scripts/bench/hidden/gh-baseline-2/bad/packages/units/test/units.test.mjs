import { test } from "node:test";
import assert from "node:assert/strict";
import { kmToMiles } from "../src/index.mjs";

test("kmToMiles converts 100 km to about 62.14 miles", () => {
  assert.ok(Math.abs(kmToMiles(100) - 62.1371) < 0.001);
});
