import { test } from "node:test";
import assert from "node:assert/strict";
import { sumColumn } from "../src/sum.mjs";

test("sumColumn adds a column below the header", () => {
  assert.equal(sumColumn("n,v\na,1\nb,2.5\n", 1), 3.5);
});

test("sumColumn rejects a non-number", () => {
  assert.throws(() => sumColumn("n,v\na,x\n", 1), TypeError);
});
