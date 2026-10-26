#!/usr/bin/env node
// CLI over teams/mcp/scope.mjs.
//   node teams/scripts/scope.mjs baseline [--cwd DIR] [--out FILE]   write the baseline JSON (stdout if no --out)
//   node teams/scripts/scope.mjs touched  [--cwd DIR] --baseline FILE  print touched paths, one per line
import { readFileSync, writeFileSync } from 'node:fs';
import { baseline, touched } from '../mcp/scope.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const cwd = opt('cwd') ?? process.cwd();

try {
  if (cmd === 'baseline') {
    const json = JSON.stringify(baseline(cwd), null, 1) + '\n';
    const out = opt('out');
    if (out) writeFileSync(out, json);
    else process.stdout.write(json);
  } else if (cmd === 'touched') {
    const file = opt('baseline');
    const base = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const paths = touched(cwd, base);
    if (paths.length) process.stdout.write(paths.join('\n') + '\n');
  } else {
    process.stderr.write('usage: scope.mjs baseline|touched [--cwd DIR] [--out FILE | --baseline FILE]\n');
    process.exit(2);
  }
} catch (e) {
  process.stderr.write(`scope: ${e.message}\n`);
  process.exit(1);
}
