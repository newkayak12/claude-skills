import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../vendor/slug.mjs";

test("slugify lowercases and joins words with a hyphen", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("slugify collapses runs of spaces and trims", () => {
  assert.equal(slugify("  Many   Spaces "), "many-spaces");
});
