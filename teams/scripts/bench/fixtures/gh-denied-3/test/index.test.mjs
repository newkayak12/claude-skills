import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVICE } from "../src/index.mjs";

test("service name", () => {
  assert.equal(SERVICE, "uploads");
});
