import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRow } from "../src/rows.mjs";

// Reads a sample export that is not checked into this repository.
test("sample file lists three rows", () => {
  const lines = fs.readFileSync(new URL("../data/sample.csv", import.meta.url), "utf8").trim().split("\n");
  assert.equal(lines.map(parseRow).length, 3);
});
