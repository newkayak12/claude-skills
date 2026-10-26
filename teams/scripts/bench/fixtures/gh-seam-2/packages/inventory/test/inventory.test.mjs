import { test } from "node:test";
import assert from "node:assert/strict";
import { listItems } from "../src/index.mjs";

// Fixed by the fixture: this is the contract of the inventory package.
test("listItems returns sku/qty records", () => {
  assert.deepEqual(listItems(), [
    { sku: "A1", qty: 5 },
    { sku: "B2", qty: 0 },
    { sku: "C3", qty: 12 },
  ]);
});
