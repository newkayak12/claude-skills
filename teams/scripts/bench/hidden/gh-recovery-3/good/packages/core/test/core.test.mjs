import test from "node:test";
import assert from "node:assert/strict";
import { titleCase } from "../src/index.mjs";

test("titleCase", () => {
  assert.equal(titleCase("aDa LOVElace"), "Ada Lovelace");
});
