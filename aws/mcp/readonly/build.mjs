#!/usr/bin/env node
// Bundles the server and its dependencies into dist/aws-readonly.mjs, the file the plugin runs,
// so an installed copy needs no npm install (no network, no two sessions installing at once).
// Run after any change to the sources or package-lock.json: npm run build. A test fails on a stale bundle.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, 'dist', 'aws-readonly.mjs');

// The inputs whose change makes the bundle stale: every .mjs source beside this file (not tests,
// dist or node_modules, not this build script) and the lockfile.
export function sourceHash() {
  const files = [...readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'build.mjs'), 'package-lock.json'].sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f).update('\0').update(readFileSync(join(here, f))).update('\0');
  return h.digest('hex').slice(0, 16);
}

export const bundleHash = () => readFileSync(OUT, 'utf8').match(/^\/\/ sources: ([0-9a-f]+)$/m)?.[1];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { build } = await import('esbuild');
  const { rmSync } = await import('node:fs');
  rmSync(join(here, 'dist'), { recursive: true, force: true });
  await build({
    stdin: { contents: "import { main } from './server.mjs';\nawait main();\n", resolveDir: here, sourcefile: 'entry.mjs' },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: OUT,
    legalComments: 'none',
    banner: {
      js: [
        '#!/usr/bin/env node',
        '// readonly-aws MCP server, bundled by build.mjs — do not edit; edit the sources and run npm run build.',
        `// sources: ${sourceHash()}`,
        "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
      ].join('\n'),
    },
    logLevel: 'warning',
  });
  process.stderr.write(`built ${OUT}\n`);
}
