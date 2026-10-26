import { test } from "node:test";
import assert from "node:assert/strict";
import { titleCase } from "../src/title.mjs";

test("titleCase capitalizes each word", () => {
  assert.equal(titleCase("hello   BIG world"), "Hello Big World");
  assert.equal(titleCase("   "), "");
});
