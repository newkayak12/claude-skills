import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPICS } from "../src/index.mjs";

// Fixed by the fixture: this is the contract of the topics package.
test("TOPICS fixes the topic names", () => {
  assert.deepEqual({ ...TOPICS }, { USER_CREATED: "user.created", USER_DELETED: "user.deleted" });
});
