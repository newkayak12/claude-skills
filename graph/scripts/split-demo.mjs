#!/usr/bin/env node
// Splits the stdout of `cd graph && claude plugin test .` (on stdin) into <dir>/demo-<scenario>-<width>.txt files.
// The demo test prints each render between `=== demo-<s>-<w> ===` and `=== end ===`.
// usage: command claude plugin test . | node graph/scripts/split-demo.mjs <dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: split-demo.mjs <dir>  (test stdout on stdin)');
  process.exit(1);
}
const files = {};
let name = null;
for (const line of readFileSync(0, 'utf8').split('\n')) {
  const open = /^=== (demo-[a-z]+-\d+) ===$/.exec(line);
  if (open) files[(name = open[1])] = [];
  else if (line === '=== end ===') name = null;
  else if (name) files[name].push(line);
}
mkdirSync(dir, { recursive: true });
for (const [n, lines] of Object.entries(files)) writeFileSync(join(dir, `${n}.txt`), lines.join('\n') + '\n');
console.log(`wrote ${Object.keys(files).length} files to ${dir}`);
