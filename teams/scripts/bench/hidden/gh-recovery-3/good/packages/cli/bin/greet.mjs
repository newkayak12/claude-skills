#!/usr/bin/env node
import { greeting } from "../../fmt/src/index.mjs";

const name = process.argv.slice(2).join(" ");
if (!name) {
  console.error("usage: greet <name>");
  process.exit(1);
}
console.log(greeting(name));
