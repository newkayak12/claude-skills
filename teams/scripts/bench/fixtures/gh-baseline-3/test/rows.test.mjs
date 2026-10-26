import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRow } from "../src/rows.mjs";

test("parseRow trims cells", () => {
  assert.deepEqual(parseRow(" a, b ,c"), ["a", "b", "c"]);
});
