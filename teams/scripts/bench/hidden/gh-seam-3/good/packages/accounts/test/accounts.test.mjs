import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribe, reset } from "../../bus/src/index.mjs";
import { TOPICS } from "../../topics/src/index.mjs";
import { createUser } from "../src/index.mjs";

test("createUser publishes the canonical created topic", () => {
  reset();
  const seen = [];
  subscribe(TOPICS.USER_CREATED, (p) => seen.push(p.name));
  createUser("ann");
  assert.deepEqual(seen, ["ann"]);
});
