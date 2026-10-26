import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribe, publish, reset } from "../src/index.mjs";

test("publish reaches subscribers of the same topic only", () => {
  reset();
  const seen = [];
  subscribe("a", (p) => seen.push(p));
  publish("a", 1);
  publish("b", 2);
  assert.deepEqual(seen, [1]);
});
