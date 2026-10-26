import { test } from "node:test";
import assert from "node:assert/strict";
import { reset, publish } from "../../bus/src/index.mjs";
import { TOPICS } from "../../topics/src/index.mjs";
import { startAudit, entries } from "../src/index.mjs";

test("startAudit records canonical topics", () => {
  reset();
  startAudit();
  publish(TOPICS.USER_CREATED, { name: "bo" });
  assert.deepEqual(entries(), ["user.created:bo"]);
});
