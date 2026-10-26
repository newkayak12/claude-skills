import { test } from "node:test";
import assert from "node:assert/strict";
import { reset, publish } from "../../bus/src/index.mjs";
import { startAudit, entries } from "../src/index.mjs";

test("startAudit records user events", () => {
  reset();
  startAudit();
  publish("user.created", { name: "bo" });
  assert.deepEqual(entries(), ["user.created:bo"]);
});
