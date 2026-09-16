#!/usr/bin/env node
// lintcfg — `lintcfg check <file>`. Always runs when invoked as a script: a bin entry point is
// never imported as a library, so there is nothing to gate on being "the main module" and
// nothing to compare `import.meta.url` against `process.argv[1]` for. That comparison is the
// known-fragile pattern (0.8.1's defect) that breaks under a macOS /var -> /private/var symlink
// — this file simply does not need it, which is the fix, not a workaround.
import { readFileSync } from 'node:fs';
import { parseConfig } from '../../parser/src/index.mjs';
import { EXIT_CODES } from '../../codes/src/index.mjs';

function main(argv) {
  const [cmd, file] = argv;
  if (cmd !== 'check' || !file) {
    console.log(`Error [${EXIT_CODES.PARSE_ERROR}] usage: lintcfg check <file>`);
    process.exitCode = EXIT_CODES.PARSE_ERROR;
    return;
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.log(`Error [${EXIT_CODES.PARSE_ERROR}] cannot read file: ${file}`);
    process.exitCode = EXIT_CODES.PARSE_ERROR;
    return;
  }
  const result = parseConfig(text);
  if (result.ok) {
    const { name, port, timeout } = result.value;
    console.log(`OK name=${name} port=${port} timeout=${timeout}`);
    process.exitCode = EXIT_CODES.OK;
    return;
  }
  const n = EXIT_CODES[result.code];
  console.log(`Error [${n}] ${result.message}`);
  process.exitCode = n;
}

main(process.argv.slice(2));
