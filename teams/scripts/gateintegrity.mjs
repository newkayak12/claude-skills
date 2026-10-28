#!/usr/bin/env node
// CLI over teams/mcp/gateintegrity.mjs.
//   node teams/scripts/gateintegrity.mjs [--cwd DIR] --baseline SHA
// Prints one `<tag>\t<file>:<line>\t<text>` line per test weakening against SHA.
// Exit 0 none found, 1 found, 2 usage error (no --baseline, or git cannot resolve it).
import { gateIntegrity, formatList } from '../mcp/gateintegrity.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const usage = (why) => {
  process.stderr.write(`${why ? `gateintegrity: ${why}\n` : ''}usage: gateintegrity.mjs [--cwd DIR] --baseline SHA\n`);
  process.exit(2);
};

const cwd = opt('cwd') ?? process.cwd();
const baseline = opt('baseline');
if (!baseline || baseline.startsWith('-')) usage();

let findings;
try {
  findings = gateIntegrity({ cwd, baseline });
} catch (e) {
  usage(String(e.stderr || e.message).trim().split('\n')[0]);
}
process.stdout.write(formatList(findings));
process.exit(findings.length ? 1 : 0);
