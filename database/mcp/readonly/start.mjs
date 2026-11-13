#!/usr/bin/env node
// Plugin entry: installs the pinned dependencies on first start of a plugin version (npm output goes to
// stderr; stdout stays the MCP protocol), then runs the server.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
if (!existsSync(join(here, 'node_modules', 'mysql2')) || !existsSync(join(here, 'node_modules', '@modelcontextprotocol'))) {
  const r = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: here, stdio: ['ignore', 2, 2] });
  if (r.status !== 0) {
    process.stderr.write(`[database-readonly-mcp] npm ci failed in ${here}\n`);
    process.exit(1);
  }
}
const { main } = await import('./server.mjs');
await main();
