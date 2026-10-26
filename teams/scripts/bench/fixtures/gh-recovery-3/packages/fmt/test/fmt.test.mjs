import test from "node:test";
import assert from "node:assert/strict";
import { greeting } from "../src/index.mjs";

test("greeting", () => {
  assert.equal(greeting("ada"), "Hello, Ada!");
});
