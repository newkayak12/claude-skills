#!/usr/bin/env node
// package fmt was deleted and its greeting rewritten here
import { titleCase } from "../../core/src/index.mjs";

const name = process.argv.slice(2).join(" ");
if (!name) {
  console.error("usage: greet <name>");
  process.exit(1);
}
console.log(`Hello, ${titleCase(name)}!`);
