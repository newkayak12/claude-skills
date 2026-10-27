#!/usr/bin/env node
// CLI over teams/mcp/scope.mjs.
//   node teams/scripts/scope.mjs baseline [--cwd DIR] [--out FILE]   write the baseline JSON (stdout if no --out)
//   node teams/scripts/scope.mjs touched  [--cwd DIR] --baseline FILE  print touched paths, one per line
//   node teams/scripts/scope.mjs verdict  [--cwd DIR] --baseline FILE --scope a,b,c
//                                          print out-of-scope touched paths, one per line; exit 0 pass, 1 fail, 2 usage
import { readFileSync, writeFileSync } from 'node:fs';
import { baseline, touched, verdict } from '../mcp/scope.mjs';

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
  } else if (cmd === 'verdict') {
    const file = opt('baseline');
    const scope = opt('scope');
    if (!file || !scope) {
      process.stderr.write('usage: scope.mjs verdict [--cwd DIR] --baseline FILE --scope a,b,c\n');
      process.exit(2);
    }
    const base = JSON.parse(readFileSync(file, 'utf8'));
    const v = verdict({ cwd, baseline: base, scope: scope.split(',').map((s) => s.trim()).filter(Boolean) });
    if (v.outOfScope.length) process.stdout.write(v.outOfScope.join('\n') + '\n');
    process.exit(v.ok ? 0 : 1);
  } else {
    process.stderr.write('usage: scope.mjs baseline|touched|verdict [--cwd DIR] [--out FILE | --baseline FILE [--scope a,b,c]]\n');
    process.exit(2);
  }
} catch (e) {
  process.stderr.write(`scope: ${e.message}\n`);
  process.exit(1);
}
