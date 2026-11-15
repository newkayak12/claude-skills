#!/usr/bin/env node
// Bundles the server and its dependencies into dist/database-readonly.mjs, the file the plugin runs,
// so an installed copy needs no npm install (no network, no two sessions installing at once).
// Run after any change to the sources or package-lock.json: npm run build. A test fails on a stale bundle.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, 'dist', 'database-readonly.mjs');

// The inputs whose change makes the bundle stale.
export function sourceHash() {
  const files = ['server.mjs', 'config.mjs', 'profiles.mjs', 'audit.mjs', 'package-lock.json', ...readdirSync(join(here, 'vendors')).map((f) => `vendors/${f}`)].sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f).update('\0').update(readFileSync(join(here, f))).update('\0');
  return h.digest('hex').slice(0, 16);
}

export const bundleHash = () => readFileSync(OUT, 'utf8').match(/^\/\/ sources: ([0-9a-f]+)$/m)?.[1];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { build } = await import('esbuild');
  await build({
    stdin: { contents: "import { main } from './server.mjs';\nawait main();\n", resolveDir: here, sourcefile: 'entry.mjs', loader: 'js' },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: OUT,
    legalComments: 'none',
    banner: {
      js: [
        '#!/usr/bin/env node',
        '// database-readonly MCP server, bundled by build.mjs — do not edit; edit the sources and run npm run build.',
        `// sources: ${sourceHash()}`,
        "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
      ].join('\n'),
    },
    logLevel: 'warning',
  });
  process.stderr.write(`built ${OUT}\n`);
}
