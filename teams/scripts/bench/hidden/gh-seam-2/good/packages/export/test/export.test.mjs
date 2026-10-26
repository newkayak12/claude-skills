import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../src/index.mjs";

test("toCsv lists every item under a header", () => {
  assert.equal(toCsv(), "sku,qty\nA1,5\nB2,0\nC3,12\n");
});
