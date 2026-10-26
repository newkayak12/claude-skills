import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords } from "../src/words.mjs";

test("countWords counts words", () => {
  assert.equal(countWords("one two  three"), 3);
  assert.equal(countWords("   "), 0);
});
